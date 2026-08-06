import crypto from "crypto";
import { esc, hashPii, emailHtml, sendEmail } from "./_email.js";

// BO_SESSION_SECRET optionnel : dérivé de SUPABASE_SERVICE_ROLE_KEY si absent
function getBoSecret() {
  const bss = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");
  if (bss) return bss;
  const srk = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (srk) return crypto.createHmac("sha256", srk).update("bo-session-fallback").digest("hex");
  return null;
}

function verifyBoToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const secret = getBoSecret();
  if (!secret) return false;
  const parts = token.split(".");
  // Support new format (ts.nonce.sig) and legacy format (ts.sig)
  const ts      = parts[0];
  const sig     = parts.length >= 3 ? parts[2] : parts[1];
  const payload = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : parts[0];
  if (!ts || !sig) return false;
  const age = Math.floor(Date.now() / 1000) - parseInt(ts, 10);
  if (isNaN(age) || age < 0 || age > 86400) return false;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch { return false; }
}

// Validation SIRET : 14 chiffres + algorithme de Luhn
function validateSiret(raw) {
  const s = String(raw || "").replace(/\s/g, "");
  if (!/^\d{14}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let n = parseInt(s[i], 10);
    if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Vérification du token BO signé
  if (!verifyBoToken(req.headers["authorization"] || "")) {
    return res.status(401).json({ error: "Non autorisé — token BO invalide ou expiré" });
  }

  const { action, profileId, ...payload } = req.body;
  const body = req.body; // alias so named-action blocks can destructure fields directly

  // Validation UUID pour profileId — évite les injections PostgREST via le paramètre de chemin
  const isUuidId = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  // Identifiant de document : la clé primaire de `documents` n'est pas un uuid mais un
  // entier (BIGSERIAL). Exiger un uuid faisait échouer toute validation et tout refus de
  // document avec « docId invalide », y compris « Tout valider » sur les 7 pièces d'un
  // prestataire — le bouton n'a donc jamais fonctionné. Les deux formes sont acceptées et
  // strictement validées : les fichiers du dépôt se contredisent sur le type de cette
  // colonne (`supabase-schema.sql` dit uuid, `supabase_schema.sql` dit BIGSERIAL) et la
  // référence est la base, pas le dépôt.
  const isDocId = (v) => {
    if (isUuidId(v)) return true;
    const s = typeof v === "number" ? String(v) : v;
    return typeof s === "string" && /^[0-9]{1,19}$/.test(s);
  };
  if (profileId !== undefined && profileId !== null && !isUuidId(profileId)) {
    return res.status(400).json({ error: "profileId invalide" });
  }
  // Sanitize : supprime espaces/sauts de ligne (copier-coller iPad/mobile)
  const SUPABASE_URL      = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  const headers = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    if (action === "list") {
      const [profilesRes, authRes, blacklistRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,role,prenom,nom,status,trial_exhausted,missions_completed_month,plan_abonnement,missions_enabled,created_at,rib&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/account_blacklist?select=email_hash,telephone_hash,iban_hash,siret_hash`, { headers }).catch(() => null),
      ]);
      const profiles = await profilesRes.json();
      const authData = await authRes.json();

      // Construire les sets de hash pour lookup O(1)
      const blData = blacklistRes ? await blacklistRes.json().catch(() => []) : [];
      const blSets = { email: new Set(), tel: new Set(), iban: new Set(), siret: new Set() };
      if (Array.isArray(blData)) {
        for (const entry of blData) {
          if (entry.email_hash)     blSets.email.add(entry.email_hash);
          if (entry.telephone_hash) blSets.tel.add(entry.telephone_hash);
          if (entry.iban_hash)      blSets.iban.add(entry.iban_hash);
          if (entry.siret_hash)     blSets.siret.add(entry.siret_hash);
        }
      }

      const authUsers = authData.users || [];
      const authMap = Object.fromEntries(authUsers.map(u => [u.id, u]));
      // Whitelist explicite des champs user_metadata exposés — évite la fuite de champs futurs sensibles
      // Liste blanche des champs user_metadata renvoyés au backoffice — elle évite
      // qu'un champ sensible ajouté plus tard ne fuite par accident.
      //
      // Elle datait d'avant l'inscription prestataire actuelle : le backoffice
      // affichait bien « Secteur », « Métier », « Tarif net », « Adresse » et
      // « Langues », mais ces champs n'étaient jamais transmis. La fiche d'un
      // prestataire se résumait donc à son email, son téléphone et son IBAN, alors
      // que l'inscription collecte une vingtaine d'informations professionnelles —
      // précisément celles sur lesquelles repose la décision de validation.
      const META_EXPOSE = [
        "telephone", "type_compte", "societe_nom", "kbis", "rib", "role", "prenom", "nom",
        // Profil professionnel du prestataire
        "secteur", "metier", "metiers_list", "tarif_net", "niveau", "experience_ans",
        "competences", "langues", "statut_pro", "siret",
        // Localisation et rayon d'intervention
        "adresse", "code_postal", "ville", "zone_km",
        // Disponibilités
        "dispon_jours", "dispo_immediat",
        // Client
        "frequence_besoins", "volume_horaire",
        // Divers
        "date_naissance", "bio",
      ];
      const merged = (Array.isArray(profiles) ? profiles : []).map(p => {
        const u = authMap[p.id] || {};
        const meta = u.user_metadata || {};
        const exposedMeta = {};
        for (const k of META_EXPOSE) if (meta[k] !== undefined) exposedMeta[k] = meta[k];
        const email = u.email || "";
        const tel   = meta.telephone || null;
        // `profiles.rib` d'abord : l'IBAN sort de user_metadata, où il était encodé
        // dans le jeton et transmis à chaque requête. Repli sur l'ancien emplacement
        // tant que la migration 2026-07-30_rgpd_iban_hors_du_jeton n'est pas passée.
        const ribBrut = p.rib || meta.rib;
        const iban  = ribBrut ? String(ribBrut).replace(/\s/g, "").toUpperCase() : null;
        const siret = meta.kbis ? String(meta.kbis).replace(/\s/g, "") : null;
        const blacklisted =
          (email && blSets.email.has(hashPii(email))) ||
          (tel   && blSets.tel.has(hashPii(tel)))     ||
          (iban  && blSets.iban.has(hashPii(iban)))   ||
          (siret && blSets.siret.has(hashPii(siret)));
        return {
          ...p,
          email,
          ...exposedMeta,
          rib: p.rib || meta.rib || null,
          blacklisted: !!blacklisted,
        };
      });
      return res.status(200).json(merged);
    }

    if (action === "approve" || action === "reject") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const status = action === "approve" ? "approved" : "rejected";
      const profilePatch = action === "approve"
        ? { status, trial_exhausted: false, missions_completed_month: 0 }
        : { status };
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const userData = await userRes.json();
      const userEmail = userData.email;

      // Validation SIRET — log uniquement, ne bloque pas l'approbation
      if (action === "approve") {
        const metaForSiret = userData.user_metadata || {};
        // L'inscription prestataire enregistre le SIRET dans `siret` ; `kbis` n'est
        // renseigné que pour les clients professionnels. Le contrôle ne lisait que
        // `kbis` : tout prestataire déclenchait donc « Prestataire sans SIRET », et
        // aucun SIRET de prestataire n'a jamais été contrôlé.
        const siretBrut = metaForSiret.siret || metaForSiret.kbis;
        const rawSiret = siretBrut ? String(siretBrut).replace(/\s/g, "") : null;
        const isPrestataire = metaForSiret.role === "prestataire";
        if (isPrestataire && !rawSiret) {
          console.warn(`[approve] Prestataire sans SIRET — profileId=${profileId}`);
        } else if (rawSiret && rawSiret.length > 0 && !validateSiret(rawSiret)) {
          console.warn(`[approve] SIRET invalide (Luhn) — profileId=${profileId} siret=${rawSiret}`);
        }
      }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(profilePatch),
      });
      if (!patchRes.ok) return res.status(500).json({ error: "Erreur mise à jour" });

      // Anti-abus à l'approbation : vérifier si les identifiants du nouveau compte
      // correspondent à un compte précédemment supprimé
      if (action === "approve") {
        const meta2 = userData.user_metadata || {};
        const tel2   = meta2.telephone || null;
        // `profiles.rib` d'abord — voir migration 2026-07-30_rgpd_iban_hors_du_jeton.
        // Sans ce repli, le contrôle anti-recréation cesserait de reconnaître un IBAN
        // déjà blacklisté dès que l'IBAN quitte le jeton.
        let ribAppr = meta2.rib;
        try {
          const rProf = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}&select=rib&limit=1`, { headers });
          const dProf = await rProf.json().catch(() => []);
          if (Array.isArray(dProf) && dProf[0]?.rib) ribAppr = dProf[0].rib;
        } catch (e) {
          console.error("[approve] lecture de profiles.rib impossible :", e.message);
        }
        const iban2  = ribAppr ? String(ribAppr).replace(/\s/g, "").toUpperCase() : null;
        const siret2 = meta2.kbis ? String(meta2.kbis).replace(/\s/g, "") : null;

        // Vérification dans les deux sens :
        // 1. Les identifiants du nouveau compte matchent-ils une entrée blacklist ?
        const orFilters = [];
        if (userEmail) orFilters.push(`email_hash.eq.${hashPii(userEmail)}`);
        if (tel2)      orFilters.push(`telephone_hash.eq.${hashPii(tel2)}`);
        if (iban2)     orFilters.push(`iban_hash.eq.${hashPii(iban2)}`);
        if (siret2)    orFilters.push(`siret_hash.eq.${hashPii(siret2)}`);

        const allFilters = [...new Set(orFilters)];

        if (allFilters.length > 0) {
          try {
            const blParams = new URLSearchParams({ or: `(${allFilters.join(",")})`, select: "id,reason,missions_completed_month,plan_abonnement", limit: "1" });
            const blRes = await fetch(`${SUPABASE_URL}/rest/v1/account_blacklist?${blParams}`, { headers });
            const blData = await blRes.json();
            if (Array.isArray(blData) && blData.length > 0) {
              const bl = blData[0];
              // Restaurer la consommation de missions du compte supprimé
              // pour empêcher de récupérer gratuitement des missions déjà utilisées
              const restoredPatch = { trial_exhausted: true };
              if (typeof bl.missions_completed_month === "number" && bl.missions_completed_month > 0) {
                restoredPatch.missions_completed_month = bl.missions_completed_month;
              }
              await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
                method: "PATCH",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify(restoredPatch),
              }).catch(() => {});
              console.warn(`[approve] Blacklist match — profileId=${profileId} email=${userEmail} missions_restored=${bl.missions_completed_month || 0} plan_deleted=${bl.plan_abonnement || "free"}`);
            }
          } catch(blErr) {
            console.error("[approve] blacklist check error:", blErr.message);
          }
        }
      }

      // Stripe Connect — créer un compte Express pour les prestataires
      let connectOnboardingUrl = null;
      const role = userData.user_metadata?.role;
      const STRIPE_SK = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
      const APP_URL_CONNECT = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";
      if (action === "approve" && role === "prestataire" && STRIPE_SK) {
        try {
          const meta = userData.user_metadata || {};
          const acctParams = new URLSearchParams({
            type: "express",
            country: "FR",
            email: userEmail || "",
            "capabilities[transfers][requested]": "true",
            business_type: "individual",
            "individual[first_name]": meta.prenom || "",
            "individual[last_name]": meta.nom || "",
          });
          const acctRes = await fetch("https://api.stripe.com/v1/accounts", {
            method: "POST",
            headers: { "Authorization": `Bearer ${STRIPE_SK}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: acctParams.toString(),
          });
          if (acctRes.ok) {
            const acctData = await acctRes.json();
            await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
              method: "PATCH",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({ stripe_account_id: acctData.id, stripe_account_status: "pending" }),
            });
            const linkParams = new URLSearchParams({
              account: acctData.id,
              refresh_url: APP_URL_CONNECT,
              return_url: APP_URL_CONNECT,
              type: "account_onboarding",
            });
            const linkRes = await fetch("https://api.stripe.com/v1/account_links", {
              method: "POST",
              headers: { "Authorization": `Bearer ${STRIPE_SK}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: linkParams.toString(),
            });
            if (linkRes.ok) { const ld = await linkRes.json(); connectOnboardingUrl = ld.url; }
          } else {
            console.error("[approve] Stripe Connect failed:", (await acctRes.json().catch(()=>({}))).error?.message);
          }
        } catch (ce) { console.error("[approve] Stripe Connect error:", ce.message); }
      }

      if (userEmail) {
        if (status === "approved") {
          const prenom = userData.user_metadata?.prenom || "";
          await sendEmail({
            to: userEmail,
            subject: "Bienvenue sur ALANE — Votre compte est activé ! 🎉",
            html: emailHtml(`
              <p>Bonjour${prenom ? ` <strong>${esc(prenom)}</strong>` : ""},</p>
              <p>Bonne nouvelle ! 🎉 Votre compte <strong>ALANE</strong> a été validé par notre équipe.</p>
              ${connectOnboardingUrl ? `
              <p style="margin-top:20px;">Pour recevoir vos paiements automatiquement après chaque prestation validée, configurez votre compte de virement en 2 minutes :</p>
              <p style="text-align:center;margin:24px 0;"><a href='${connectOnboardingUrl}' style="background:#10D98F;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Configurer mes virements →</a></p>
              <p style="color:#888;font-size:13px;margin-bottom:20px;">Ce lien est valable 24h. Il vous suffit de renseigner votre IBAN et signer les conditions générales Stripe (2 min). Sans cette étape, vos paiements ne pourront pas être versés automatiquement.</p>
              ` : ""}
              <p>Vous pouvez dès maintenant vous connecter et commencer à utiliser ALANE.</p>
              <p style="text-align:center;margin:28px 0;"><a href='${(process.env.APP_URL || "").replace(/\s/g, "")||"https://www.alane.fr"}' style="background:#7C6FE0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Accéder à ALANE →</a></p>
              <p style="color:#888;font-size:13px;">À très vite sur la plateforme,<br/>L'équipe ALANE</p>
            `),
          });
        } else {
          await sendEmail({
            to: userEmail,
            subject: "Votre demande de compte ALANE",
            html: emailHtml(`<p>Bonjour,</p><p>Nous avons examiné votre demande d'inscription mais ne sommes pas en mesure de l'activer pour le moment.</p><p>Pour plus d'informations, n'hésitez pas à contacter notre support depuis l'application.</p>`),
          });
        }
      }

      // Log action BO
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action, target_id: profileId, target_email: userEmail || null }),
      }).catch(() => {});

      return res.status(200).json({ success: true });
    }

    if (action === "enable_missions" || action === "disable_missions") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const enabled = action === "enable_missions";
      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ missions_enabled: enabled }),
      });
      if (!r.ok) return res.status(500).json({ error: "Erreur mise à jour missions_enabled" });
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action, target_id: profileId, details: { enabled } }),
      }).catch(() => {});
      return res.status(200).json({ success: true });
    }

    if (action === "delete") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const reason = req.body.reason || "";

      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const userData = await userRes.json();
      const userEmail = userData.email;

      if (userEmail) {
        const reasonBlock = reason ? `<p><strong>Raison communiquée :</strong> ${esc(reason)}</p>` : "";
        await sendEmail({
          to: userEmail,
          subject: "Votre compte ALANE a été supprimé",
          html: emailHtml(`<p>Bonjour,</p><p>Nous vous informons que votre compte <strong>ALANE</strong> a été supprimé par notre équipe d'administration.</p>${reasonBlock}<p>Si vous pensez qu'il s'agit d'une erreur, contactez notre support depuis l'application.</p>`),
        });
      }

      // Log suppression BO
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "delete", target_id: profileId, target_email: userEmail || null, reason: reason || null }),
      }).catch(() => {});

      // Anti-abus : sauvegarder les identifiants dans la blacklist pour bloquer la recréation de compte
      // Récupérer téléphone, IBAN, SIRET depuis user_metadata + consommation de missions depuis profiles
      const meta = userData.user_metadata || {};
      const telephone = meta.telephone || null;
      const siret     = meta.kbis || null;
      const savedProfileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}&select=missions_completed_month,plan_abonnement,rib&limit=1`,
        { headers }
      );
      const savedProfileRows = savedProfileRes.ok ? await savedProfileRes.json().catch(() => []) : [];
      const savedProfile = Array.isArray(savedProfileRows) && savedProfileRows.length > 0 ? savedProfileRows[0] : {};
      // L'empreinte anti-recréation doit rester calculable après la sortie de l'IBAN
      // du jeton : `profiles.rib` d'abord, ancien emplacement en repli.
      const ribSuppr  = savedProfile.rib || meta.rib;
      const iban      = ribSuppr ? String(ribSuppr).replace(/\s/g, "").toUpperCase() : null;
      if (userEmail || telephone || iban || siret) {
        await fetch(`${SUPABASE_URL}/rest/v1/account_blacklist`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            email_hash:               hashPii(userEmail),
            telephone_hash:           hashPii(telephone),
            iban_hash:                hashPii(iban),
            siret_hash:               hashPii(siret),
            reason:                   reason ? `account_deleted: ${reason}` : "account_deleted",
            missions_completed_month: savedProfile.missions_completed_month || 0,
            plan_abonnement:          savedProfile.plan_abonnement || "free",
          }),
        }).catch(() => {});
      }

      // Stripe: rembourser les missions payées assignées + annuler l'abonnement actif
      const STRIPE_SK_DEL = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
      if (STRIPE_SK_DEL) {
        try {
          const paidMissionsRes = await fetch(
            `${SUPABASE_URL}/rest/v1/missions?or=(prestataire_id.eq.${profileId},client_id.eq.${profileId})&stripe_payment_intent=not.is.null&status=in.(assigned,pending_acceptance)&select=id,client_id,prestataire_id,stripe_payment_intent,montant_total,metier,sector`,
            { headers }
          );
          const paidMissions = paidMissionsRes.ok ? await paidMissionsRes.json().catch(() => []) : [];
          for (const pm of (Array.isArray(paidMissions) ? paidMissions : [])) {
            try {
              const rfRes = await fetch("https://api.stripe.com/v1/refunds", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${STRIPE_SK_DEL}`,
                  "Content-Type": "application/x-www-form-urlencoded",
                  "Idempotency-Key": `refund-delete-${pm.id}`,
                },
                body: new URLSearchParams({ payment_intent: pm.stripe_payment_intent, reason: "fraudulent" }).toString(),
              });
              const rfData = await rfRes.json();
              if (rfData?.id) {
                console.log(`[delete] Stripe refund OK: ${rfData.id} for mission ${pm.id}`);
              } else {
                console.error(`[delete] Stripe refund failed for mission ${pm.id}:`, JSON.stringify(rfData));
              }
            } catch (e) {
              console.error(`[delete] Stripe refund exception for mission ${pm.id}:`, e.message);
            }
            // Notifier le client affecté (si ce n'est pas lui qui est supprimé)
            const affectedClient = pm.client_id !== profileId ? pm.client_id : null;
            if (affectedClient) {
              await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                method: "POST",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  user_id: affectedClient,
                  type: "system",
                  title: "Prestation annulée — remboursement en cours",
                  body: `La prestation "${pm.metier || pm.sector || ""}" a été annulée suite à la fermeture du compte prestataire. Un remboursement automatique est en cours (5-10 jours ouvrés).`,
                  read: false,
                }),
              }).catch(() => {});
            }
          }
        } catch (e) {
          console.error("[delete] Stripe refunds loop error:", e.message);
        }

        // Annuler l'abonnement Stripe actif
        try {
          const profSubRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}&select=stripe_subscription_id`, { headers });
          const profSubData = profSubRes.ok ? await profSubRes.json().catch(() => []) : [];
          const stripeSubId = Array.isArray(profSubData) && profSubData[0]?.stripe_subscription_id || null;
          if (stripeSubId) {
            await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubId}`, {
              method: "DELETE",
              headers: { "Authorization": `Bearer ${STRIPE_SK_DEL}` },
            });
            console.log(`[delete] Stripe subscription cancelled: ${stripeSubId}`);
          }
        } catch (e) {
          console.error("[delete] Stripe subscription cancel error:", e.message);
        }
      }

      // Cascade: supprimer toutes les données liées avant de supprimer le compte
      await fetch(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      // Supprimer les candidatures de ce prestataire
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?prestataire_id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      // Supprimer aussi toutes les candidatures sur les missions du client supprimé
      const clientMissionsRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?client_id=eq.${profileId}&select=id`, { headers });
      const clientMissions = clientMissionsRes.ok ? await clientMissionsRes.json().catch(() => []) : [];
      if (Array.isArray(clientMissions) && clientMissions.length > 0) {
        const missionIds = clientMissions.map(m => m.id).join(",");
        await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=in.(${missionIds})`, {
          method: "DELETE",
          headers: { ...headers, "Prefer": "return=minimal" },
        });
      }
      await fetch(`${SUPABASE_URL}/rest/v1/missions?or=(client_id.eq.${profileId},prestataire_id.eq.${profileId})`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?user_id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });

      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, {
        method: "DELETE",
        headers,
      });
      if (!r.ok) return res.status(500).json({ error: "Erreur suppression compte auth" });
      return res.status(200).json({ success: true });
    }

    if (action === "suspend") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const reason = req.body.reason || "";
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const userData = await userRes.json();
      const userEmail = userData.email;
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, { method:"PATCH", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ status:"suspended" }) });
      if (userEmail) {
        const reasonBlock = reason ? `<p><strong>Raison :</strong> ${esc(reason)}</p>` : "";
        await sendEmail({ to: userEmail, subject: "Votre compte ALANE a été suspendu", html: emailHtml(`<p>Bonjour,</p><p>Votre compte <strong>ALANE</strong> a été temporairement suspendu par notre équipe d'administration.</p>${reasonBlock}<p>Pour plus d'informations, contactez notre support depuis l'application.</p>`) });
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"suspend", target_id:profileId, target_email:userEmail||null, reason:reason||null }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "unsuspend") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const userData = await userRes.json();
      const userEmail = userData.email;
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, { method:"PATCH", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ status:"approved" }) });
      if (userEmail) {
        await sendEmail({ to: userEmail, subject: "Votre compte ALANE a été réactivé", html: emailHtml(`<p>Bonjour,</p><p>Votre compte <strong>ALANE</strong> a été réactivé. Vous pouvez à nouveau vous connecter normalement.</p>`) });
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"unsuspend", target_id:profileId, target_email:userEmail||null }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "reset_trial") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ trial_exhausted: false, missions_completed_month: 0 }),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "reset_trial", target_id: profileId }),
      }).catch(() => {});
      return res.status(200).json({ success: true });
    }

    if (action === "set_subscription") {
      const { plan, end_date } = body;
      if (!profileId || !plan) return res.status(400).json({ error: "profileId + plan requis" });
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, { method:"PATCH", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ plan_abonnement:plan, subscription_end_date:end_date||null }) }).catch(()=>{});
      const getR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const existingUser = getR.ok ? await getR.json() : {};
      const existingMeta = existingUser.user_metadata || {};
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { method:"PUT", headers, body: JSON.stringify({ user_metadata:{ ...existingMeta, plan_abonnement:plan, subscription_end_date:end_date||null } }) }).catch(()=>{});
      const planLabels = { free:"Gratuit", premium:"Premium", elite:"Elite" };
      const planLabel = planLabels[plan] || plan;
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:profileId, type:"system", title:`Abonnement mis à jour → ${planLabel}`, body:end_date?`Votre abonnement ${planLabel} est actif jusqu'au ${new Date(end_date).toLocaleDateString("fr-FR")}.`:`Votre abonnement a été mis à jour vers ${planLabel}.`, read:false }) }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"set_subscription", target_id:profileId, details:{ plan, end_date } }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "stats") {
      const [profilesRes, missionsRes, ticketsRes, recentRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=role,status,created_at`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/missions?select=status,sector,montant_total,created_at`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/support_tickets?select=status`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=prenom,nom,role,status,created_at&order=created_at.desc&limit=6`, { headers }),
      ]);

      const profiles  = await profilesRes.json();
      const missions  = await missionsRes.json();
      const tickets   = await ticketsRes.json();
      const recent    = await recentRes.json();

      const p = Array.isArray(profiles) ? profiles : [];
      const m = Array.isArray(missions) ? missions : [];
      const t = Array.isArray(tickets)  ? tickets  : [];
      const r = Array.isArray(recent)   ? recent   : [];

      const clients      = p.filter(x => x.role === "client").length;
      const prestataires = p.filter(x => x.role === "prestataire").length;
      const pending      = p.filter(x => x.status === "pending").length;

      const mOpen      = m.filter(x => x.status === "open").length;
      const mAssigned  = m.filter(x => x.status === "assigned").length;
      const mCompleted = m.filter(x => x.status === "completed").length;
      const mClosed    = m.filter(x => x.status === "closed").length;
      const mTotal     = m.length;
      const tauxCompletion = mTotal > 0 ? Math.round((mCompleted / mTotal) * 100) : 0;
      const caTotal    = m.filter(x => x.status === "completed")
        .reduce((acc, x) => acc + (Number(x.montant_total) || 0), 0);
      const caMoyen    = mCompleted > 0 ? Math.round((caTotal / mCompleted) * 100) / 100 : 0;

      const ticketsOpen = t.filter(x => x.status === "open").length;

      // Missions par secteur
      const sectorMap = {};
      m.forEach(x => {
        if (!x.sector) return;
        sectorMap[x.sector] = (sectorMap[x.sector] || 0) + 1;
      });
      const sectorTotal = Object.values(sectorMap).reduce((a,b)=>a+b, 0) || 1;
      const SECTOR_META = {
        logistique:   { label:"Logistique",   icon:"📦", color:"#81C784" },
        btp:          { label:"BTP",           icon:"🏗️", color:"#FF8A65" },
        restauration: { label:"Restauration",  icon:"🍽️", color:"#F06292" },
        proprete:     { label:"Propreté",      icon:"🧹", color:"#4FC3F7" },
        commercial:   { label:"Commercial",    icon:"💼", color:"#BA68C8" },
        hotellerie:   { label:"Hôtellerie",    icon:"🏨", color:"#FFB74D" },
        distribution: { label:"Distribution",  icon:"🛒", color:"#4DB6AC" },
        divers:       { label:"Divers",        icon:"✨", color:"#7986CB" },
      };
      const sectors = Object.entries(sectorMap)
        .sort((a,b) => b[1]-a[1])
        .map(([id, count]) => ({
          id, ...SECTOR_META[id],
          missions: count,
          pct: Math.round((count / sectorTotal) * 100),
        }));

      // Monthly time-series (last 6 months)
      const now = new Date();
      const last6months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        return d.toISOString().slice(0, 7);
      });
      const signupsByMonth = Object.fromEntries(last6months.map(mo => [mo, 0]));
      const missionsByMonth = Object.fromEntries(last6months.map(mo => [mo, 0]));
      const caByMonth = Object.fromEntries(last6months.map(mo => [mo, 0]));
      p.forEach(x => {
        const mo = x.created_at?.slice(0, 7);
        if (mo && signupsByMonth[mo] !== undefined) signupsByMonth[mo]++;
      });
      m.forEach(x => {
        const mo = x.created_at?.slice(0, 7);
        if (mo && missionsByMonth[mo] !== undefined) {
          missionsByMonth[mo]++;
          if (x.status === "completed") caByMonth[mo] = (caByMonth[mo] || 0) + (Number(x.montant_total) || 0);
        }
      });
      const monthLabels = last6months.map(mo => {
        const [y, mIdx] = mo.split("-");
        return new Date(Number(y), Number(mIdx) - 1, 1).toLocaleDateString("fr-FR", { month:"short" });
      });

      return res.status(200).json({
        users:        { clients, prestataires, total: clients + prestataires, pending },
        missions:     { total: mTotal, open: mOpen, assigned: mAssigned, terminees: mCompleted, closed: mClosed, tauxCompletion },
        finance:      { caTotal: Math.round(caTotal * 100) / 100, caMoyen },
        tickets:      { open: ticketsOpen, total: t.length },
        sectors,
        recentUsers:  r,
        signupsByMonth,
        missionsByMonth,
        caByMonth,
        monthLabels,
      });
    }

    if (action === "list_tickets") {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?select=*&order=created_at.desc`, { headers });
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (action === "list_disputes") {
      const missionsRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?status=eq.disputed&select=id,metier,titre,date,montant_total,client_id,prestataire_id,stripe_payment_intent&order=created_at.desc`, { headers });
      const missions = await missionsRes.json();
      if (!Array.isArray(missions) || missions.length === 0) return res.status(200).json([]);

      // Récupérer les emails des clients et prestataires depuis auth.users
      const userIds = [...new Set([
        ...missions.map(m => m.client_id).filter(Boolean),
        ...missions.map(m => m.prestataire_id).filter(Boolean),
      ])];
      let emailMap = {};
      if (userIds.length > 0) {
        try {
          const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers });
          const authData = await authRes.json();
          (authData.users || []).forEach(u => { emailMap[u.id] = u.email; });
        } catch {}
      }

      const enriched = missions.map(m => ({
        ...m,
        client_email: emailMap[m.client_id] || null,
        presta_email: m.prestataire_id ? (emailMap[m.prestataire_id] || null) : null,
      }));
      return res.status(200).json(enriched);
    }

    if (action === "resolve_dispute") {
      const { mission_id, resolution } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      if (!["refunded", "rejected"].includes(resolution)) return res.status(400).json({ error: "resolution invalide (refunded|rejected)" });

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,metier,sector,stripe_payment_intent,montant_total`, { headers });
      const rows = await mr.json();
      const m = Array.isArray(rows) && rows[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (m.status !== "disputed") return res.status(400).json({ error: "La prestation n'est pas en litige" });

      // Pour resolution="refunded" : déclencher le remboursement Stripe réel avant de fermer
      if (resolution === "refunded" && m.stripe_payment_intent) {
        const STRIPE_SK = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
        if (!STRIPE_SK) return res.status(500).json({ error: "Stripe non configuré — remboursement impossible" });
        try {
          const rfRes = await fetch("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${STRIPE_SK}`,
              "Content-Type": "application/x-www-form-urlencoded",
              "Idempotency-Key": `refund-dispute-${mission_id}`,
            },
            body: new URLSearchParams({ payment_intent: m.stripe_payment_intent, reason: "fraudulent" }).toString(),
          });
          const rfData = await rfRes.json();
          if (!rfData?.id) {
            console.error("[resolve_dispute] Stripe refund failed:", JSON.stringify(rfData));
            return res.status(500).json({ error: `Remboursement Stripe échoué : ${rfData?.error?.message || "erreur inconnue"}` });
          }
          console.log(`[resolve_dispute] Stripe refund OK: ${rfData.id} pour prestation ${mission_id}`);
        } catch (e) {
          console.error("[resolve_dispute] Stripe refund exception:", e.message);
          return res.status(500).json({ error: "Erreur lors du remboursement Stripe — prestation non fermée" });
        }
      }

      // "refunded" → closed, "rejected" → completed (prestation validée malgré le litige)
      const newStatus = resolution === "refunded" ? "closed" : "completed";
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (resolution === "rejected") {
        // Litige rejeté — notifier le client et le prestataire
        if (m.client_id) {
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.client_id, type:"system", title:"Litige clôturé ℹ️", body:"Après examen de votre dossier, le litige a été clôturé en faveur du prestataire. La prestation a été validée.", read:false }) }).catch(()=>{});
        }
        if (m.prestataire_id) {
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.prestataire_id, type:"system", title:"Litige résolu en votre faveur ✅", body:"Le litige a été examiné et clôturé en votre faveur. La prestation est validée.", read:false }) }).catch(()=>{});
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"resolve_dispute", target_id:mission_id, details:{ resolution } }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "close_ticket") {
      if (!profileId) return res.status(400).json({ error: "ticketId requis" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?id=eq.${profileId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (!r.ok) return res.status(500).json({ error: "Erreur fermeture ticket" });
      return res.status(200).json({ success: true });
    }

    if (action === "delete_ticket") {
      if (!profileId) return res.status(400).json({ error: "ticketId requis" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      if (!r.ok) return res.status(500).json({ error: "Erreur suppression ticket" });
      return res.status(200).json({ success: true });
    }

    if (action === "send_global_comm") {
      const message = req.body.message || "";
      if (!message.trim()) return res.status(400).json({ error: "Message requis" });

      // Récupérer tous les prestataires approuvés
      const [profilesRes, authRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&role=eq.prestataire&status=eq.approved`, { headers }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers }),
      ]);
      const profiles = await profilesRes.json();
      const authData = await authRes.json();
      const authUsers = authData.users || [];
      const ids = new Set((Array.isArray(profiles) ? profiles : []).map(p => p.id));
      const emails = authUsers.filter(u => ids.has(u.id)).map(u => u.email).filter(Boolean);

      let sent = 0;
      const chunks = [];
      for (let i = 0; i < emails.length; i += 5) chunks.push(emails.slice(i, i + 5));
      for (const chunk of chunks) {
        await Promise.all(chunk.map(email =>
          sendEmail({
            to: email,
            subject: "📢 Communication de l'équipe ALANE",
            html: emailHtml(`<p>Bonjour,</p><p>${esc(message).replace(/\n/g,"<br/>")}</p><p style="color:#888;font-size:13px;">L'équipe ALANE</p>`),
          }).then(() => { sent++; }).catch(() => {})
        ));
      }
      return res.status(200).json({ success: true, sent });
    }

    if (action === "send_user_email") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const { subject, message } = req.body;
      if (!subject?.trim() || !message?.trim()) return res.status(400).json({ error: "Sujet et message requis" });
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const userData = await userRes.json();
      const userEmail = userData.email;
      if (!userEmail) return res.status(404).json({ error: "Email introuvable" });
      const prenom = userData.user_metadata?.prenom || "";
      await sendEmail({
        to: userEmail,
        subject: subject.trim(),
        html: emailHtml(`
          <p>Bonjour${prenom ? ` <strong>${esc(prenom)}</strong>` : ""},</p>
          <p>${esc(message.trim()).replace(/\n/g,"<br/>")}</p>
          <p style="color:#888;font-size:13px;">L'équipe ALANE</p>
        `),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "send_user_email", target_id: profileId, target_email: userEmail }),
      }).catch(() => {});
      return res.status(200).json({ success: true });
    }

    if (action === "send_test_email") {
      const adminEmail = process.env.ADMIN_EMAIL || "direction@alane.fr";
      await sendEmail({
        to: adminEmail,
        subject: "✅ Test email ALANE — configuration Resend OK",
        html: emailHtml(`
          <p>Bonjour,</p>
          <p>Ceci est un email de test envoyé depuis le backoffice <strong>ALANE</strong>.</p>
          <p>Si vous recevez cet email, la configuration Resend est correctement opérationnelle.</p>
          <p style="color:#888;font-size:13px;">Envoyé le ${new Date().toLocaleString("fr-FR")} depuis le BO ALANE.</p>
        `),
      });
      return res.status(200).json({ success: true });
    }

    if (action === "list_docs") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${profileId}&select=*&order=created_at.desc`, { headers });
      const docs = await r.json();
      const docsArray = Array.isArray(docs) ? docs : [];

      // Vérifie si l'utilisateur a une photo dans user_metadata
      const authKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
      let photoEntry = null;
      try {
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, {
          headers: { "apikey": authKey, "Authorization": `Bearer ${authKey}` },
        });
        const userData = userRes.ok ? await userRes.json() : null;
        const photoUrl = userData?.user_metadata?.photo_url || null;
        if (photoUrl) {
          photoEntry = { id: "photo_virtual", prestataire_id: profileId, type: "photo", storage_path: null, verified: false, created_at: null, signedUrl: photoUrl, isVirtual: true };
        }
      } catch (e) { void e; }

      // Générer des URLs signées (1h) pour chaque doc — bucket "Documents" (majuscule)
      const withUrls = await Promise.all(docsArray.map(async (doc) => {
        try {
          const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/Documents/${doc.storage_path}`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ expiresIn: 3600 }),
          });
          const sj = await sr.json();
          return { ...doc, signedUrl: sj.signedURL ? `${SUPABASE_URL}/storage/v1${sj.signedURL}` : null };
        } catch (e) { void e; return { ...doc, signedUrl: null }; }
      }));

      const result = photoEntry ? [photoEntry, ...withUrls] : withUrls;
      return res.status(200).json(result);
    }

    if (action === "list_all_docs") {
      // Récupère tous les documents + infos prestataire
      const docsRes = await fetch(`${SUPABASE_URL}/rest/v1/documents?select=*&order=created_at.desc`, { headers });
      const allDocs = await docsRes.json();
      if (!Array.isArray(allDocs)) return res.status(200).json([]);

      // Récupère les profils pour les noms
      const ids = [...new Set(allDocs.map(d => d.prestataire_id))];
      let profileMap = {};
      if (ids.length) {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids.join(",")})&select=id,prenom,nom`, { headers });
        const profs = await pr.json();
        if (Array.isArray(profs)) profs.forEach(p => { profileMap[p.id] = p; });
      }

      // Récupère les emails depuis auth.users
      const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers: { ...headers, "apikey": (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, ""), "Authorization": `Bearer ${(process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "")}` } });
      const usersData = await usersRes.json();
      let emailMap = {};
      if (usersData?.users) usersData.users.forEach(u => { emailMap[u.id] = u.email; });

      // Génère les signed URLs
      const withUrls = await Promise.all(allDocs.map(async (doc) => {
        let signedUrl = null;
        try {
          const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/Documents/${doc.storage_path}`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ expiresIn: 3600 }),
          });
          const sj = await sr.json();
          signedUrl = sj.signedURL ? `${SUPABASE_URL}/storage/v1${sj.signedURL}` : null;
        } catch {}
        const prof = profileMap[doc.prestataire_id] || {};
        const meta = usersData?.users?.find(u => u.id === doc.prestataire_id)?.user_metadata || {};
        const prenom = prof.prenom || meta.prenom || "";
        const nom = prof.nom || meta.nom || "";
        return { ...doc, signedUrl, prenom, nom, email: emailMap[doc.prestataire_id] || "" };
      }));
      return res.status(200).json(withUrls);
    }

    if (action === "verify_doc") {
      if (!profileId || !req.body.docId) return res.status(400).json({ error: "profileId + docId requis" });
      if (!isDocId(req.body.docId)) return res.status(400).json({ error: "Identifiant de document invalide" });
      // Vérifier que le document appartient bien au profil demandé.
      // Le message d'erreur distingue les deux causes possibles : sans cette
      // distinction, « document non trouvé pour ce profil » ne permettait pas de
      // savoir si la ligne avait disparu ou si elle appartenait à un autre compte —
      // cas réel après recréation d'un compte, les documents gardant l'ancien
      // identifiant de prestataire.
      const docCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${req.body.docId}&select=id,prestataire_id`, { headers });
      const docCheckData = await docCheckRes.json().catch(() => []);
      const docTrouve = Array.isArray(docCheckData) && docCheckData[0];
      if (!docTrouve) {
        return res.status(404).json({ error: "Ce document n'existe plus en base — rafraîchissez la liste (🔄)." });
      }
      if (docTrouve.prestataire_id !== profileId) {
        console.error(`[verify_doc] document ${req.body.docId} rattaché à ${docTrouve.prestataire_id}, demandé pour ${profileId}`);
        return res.status(403).json({ error: "Ce document appartient à un autre compte prestataire." });
      }
      const patchDocRes = await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${req.body.docId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ verified: true }),
      });
      // L'écriture n'était pas vérifiée : un refus de PostgREST renvoyait quand même
      // « success: true » et l'écran affichait le document comme validé alors qu'il
      // ne l'était pas en base.
      const patchDocData = await patchDocRes.json().catch(() => null);
      if (!patchDocRes.ok || !Array.isArray(patchDocData) || patchDocData.length === 0) {
        const detail = patchDocRes.ok ? "aucune ligne modifiée" : JSON.stringify(patchDocData || {});
        console.error(`[verify_doc] échec de l'écriture pour ${req.body.docId} : ${patchDocRes.status} ${detail}`);
        return res.status(500).json({ error: `La validation n'a pas pu être enregistrée (${patchDocRes.status}).` });
      }
      // Marquer le profil comme ayant au moins un document vérifié
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ docs_verified: true }),
      }).catch(() => {}); // Ignoré si la colonne n'existe pas encore (migration non appliquée)
      return res.status(200).json({ success: true });
    }

    // Refuser un document : il est retiré (ligne + fichier) pour que le prestataire
    // puisse en redéposer un, et une notification lui explique quoi corriger.
    // Sans colonne dédiée en base, un document « refusé » serait indiscernable
    // d'un document jamais examiné : le retirer est plus clair pour les deux côtés.
    if (action === "reject_doc") {
      if (!profileId || !req.body.docId) return res.status(400).json({ error: "profileId + docId requis" });
      if (!isDocId(req.body.docId)) return res.status(400).json({ error: "Identifiant de document invalide" });
      const motif = String(req.body.motif || "").trim().slice(0, 300);
      if (!motif) return res.status(400).json({ error: "Motif de refus requis" });

      const docRes = await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${req.body.docId}&prestataire_id=eq.${profileId}&select=id,type,storage_path`, { headers });
      const docData = await docRes.json().catch(() => []);
      const doc = Array.isArray(docData) && docData[0];
      if (!doc) return res.status(403).json({ error: "Document non trouvé pour ce profil" });

      if (doc.storage_path) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/Documents/${doc.storage_path}`, {
          method: "DELETE", headers,
        }).catch(e => console.error("[reject_doc] suppression du fichier échouée :", e.message));
      }

      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${req.body.docId}`, {
        method: "DELETE", headers: { ...headers, "Prefer": "return=minimal" },
      });
      if (!delRes.ok) {
        const txt = await delRes.text().catch(() => "");
        console.error("[reject_doc] suppression de la ligne échouée :", delRes.status, txt);
        return res.status(500).json({ error: "Suppression du document échouée" });
      }

      const LABELS = {
        kbis:"KBIS / SIRET", rib:"RIB / IBAN", cni:"Pièce d'identité", photo:"Photo de profil",
        urssaf:"Attestation URSSAF", domicile:"Justificatif de domicile", rc_pro:"RC Professionnelle",
        rcpro:"RC Professionnelle", tva:"Attestation TVA", diplomes:"Diplômes", autre:"Autre document",
      };
      const label = LABELS[doc.type] || doc.type;
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          user_id: profileId,
          type:    "system",
          title:   `Document à renvoyer : ${label}`,
          body:    `Votre document « ${label} » n'a pas pu être validé. Motif : ${motif}. Merci de déposer un nouveau document depuis votre espace.`,
          read:    false,
        }),
      }).catch(e => console.error("[reject_doc] notification échouée :", e.message));

      return res.status(200).json({ success: true, type: doc.type });
    }

    if (action === "visits_stats") {
      const now = new Date();
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startWeek  = new Date(now.getTime() - 7 * 86400000).toISOString();
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [todayR, weekR, monthR, totalR] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/visits?created_at=gte.${startToday}&select=id`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/visits?created_at=gte.${startWeek}&select=id`,  { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/visits?created_at=gte.${startMonth}&select=id`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/visits?select=id`, { headers }),
      ]);

      const [today, week, month, total] = await Promise.all([
        todayR.json(), weekR.json(), monthR.json(), totalR.json(),
      ]);

      // Visites par jour sur les 14 derniers jours
      const start14 = new Date(now.getTime() - 13 * 86400000).toISOString();
      const allR = await fetch(`${SUPABASE_URL}/rest/v1/visits?created_at=gte.${start14}&select=created_at&order=created_at.asc`, { headers });
      const all  = await allR.json();
      const byDay = {};
      (Array.isArray(all) ? all : []).forEach(v => {
        const d = v.created_at?.slice(0, 10);
        if (d) byDay[d] = (byDay[d] || 0) + 1;
      });

      return res.status(200).json({
        today: Array.isArray(today) ? today.length : 0,
        week:  Array.isArray(week)  ? week.length  : 0,
        month: Array.isArray(month) ? month.length : 0,
        total: Array.isArray(total) ? total.length : 0,
        byDay,
      });
    }

    if (action === "list_missions") {
      // S-11: whitelist status values to prevent injection via the status param
      const VALID_STATUSES = ["open","pending_acceptance","assigned","completed","closed","rejected","refused","cancelled"];
      const rawStatus = req.body.status;
      const statusFilter = rawStatus && rawStatus !== "all" && VALID_STATUSES.includes(rawStatus) ? `&status=eq.${rawStatus}` : "";
      const [missionsRes, authRes, profilesRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/missions?select=id,status,sector,metier,date,hours,tarif_horaire,montant_total,created_at,client_id,prestataire_id,validation_prestataire,validation_client,ville,recurrence,started_at,arrived_at${statusFilter}&order=created_at.desc&limit=300`, { headers }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,prenom,nom`, { headers }),
      ]);
      const missions  = await missionsRes.json();
      const authData  = await authRes.json();
      const profiles  = await profilesRes.json();
      const authMap   = {};
      (authData.users || []).forEach(u => { authMap[u.id] = { email: u.email, meta: u.user_metadata || {} }; });
      const nameMap = {};
      (Array.isArray(profiles) ? profiles : []).forEach(p => {
        const n = `${p.prenom||""} ${p.nom||""}`.trim();
        nameMap[p.id] = n || (authMap[p.id]?.meta?.prenom ? `${authMap[p.id].meta.prenom} ${authMap[p.id].meta.nom||""}`.trim() : "");
      });
      const enriched = (Array.isArray(missions) ? missions : []).map(m => ({
        ...m,
        client_name: nameMap[m.client_id] || "Client",
        presta_name: m.prestataire_id ? (nameMap[m.prestataire_id] || "Prestataire") : null,
      }));
      return res.status(200).json(enriched);
    }

    if (action === "force_complete_mission") {
      const { mission_id } = req.body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,hours,tarif_horaire,metier,sector,recurrence,date,heure_debut,ville`, { headers });
      const rows = await mr.json();
      const m = Array.isArray(rows) && rows[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (!["assigned","pending_acceptance"].includes(m.status)) return res.status(400).json({ error: `Statut ${m.status} — seules les prestations assigned/pending_acceptance peuvent être validées` });
      const montantTotal = Math.round((m.hours||0) * (m.tarif_horaire||0) * 100) / 100;
      // PATCH atomique — garde le guard status=eq.assigned pour éviter double-crédit
      const patchStatus = m.status === "pending_acceptance" ? "pending_acceptance" : "assigned";
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=eq.${patchStatus}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation", "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", montant_total: montantTotal, validation_prestataire: true, validation_client: true }),
      });
      const patched = await patchRes.json().catch(() => []);
      if (!Array.isArray(patched) || patched.length === 0) return res.status(409).json({ error: "Prestation déjà validée ou statut changé" });
      // Cashback client
      let CASHBACK_TIERS = [{ min:0,max:2,rate:0.005 },{ min:3,max:5,rate:0.0075 },{ min:6,max:9,rate:0.01 },{ min:10,max:999,rate:0.015 }];
      try { const cbR = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=eq.cashback_rates&select=value`,{headers}); const cbD = await cbR.json(); if(Array.isArray(cbD)&&Array.isArray(cbD[0]?.value)) CASHBACK_TIERS=cbD[0].value; } catch {}
      const profileR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.client_id}&select=cashback_balance,missions_completed_month`, { headers });
      const profileD = await profileR.json();
      const prof = Array.isArray(profileD) && profileD[0];
      const mCount = (prof?.missions_completed_month||0)+1;
      const rate = [...CASHBACK_TIERS].reverse().find(t=>mCount>=t.min)?.rate||0.01;
      const cashback = Math.round(montantTotal*rate*100)/100;
      const cashbackRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, { method:"POST", headers:{...headers,"Prefer":"return=representation"}, body: JSON.stringify({ p_user_id:m.client_id, p_delta:cashback, p_missions:1 }) }).catch(()=>null);
      if (!cashbackRes?.ok) console.error(`[force_complete] cashback RPC failed for mission ${mission_id} — manual credit may be needed`);
      // Notification prestataire
      if (m.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.prestataire_id, type:"mission", title:"Prestation validée ✅", body:`Votre prestation "${m.metier||m.sector}" du ${m.date} a été validée. Votre paiement est en cours.`, read:false }) }).catch(()=>{});
      }
      // Notification client
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.client_id, type:"mission", title:"Prestation validée ✅", body:`Votre prestation "${m.metier||m.sector}" du ${m.date} a été validée.${cashback>0?` Cashback +${cashback.toFixed(2)} €`:""}`, read:false }) }).catch(()=>{});
      // Incrémenter le quota mensuel du prestataire (comme pour une mission validée normalement)
      if (m.prestataire_id) {
        const prQ = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.prestataire_id}&select=missions_completed_month`, { headers }).catch(() => null);
        const prD = prQ?.ok ? await prQ.json().catch(() => []) : [];
        const currentMC = Array.isArray(prD) && prD[0] ? (prD[0].missions_completed_month || 0) : 0;
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.prestataire_id}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ missions_completed_month: currentMC + 1 }),
        }).catch(() => {});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"force_complete_mission", target_id:mission_id }) }).catch(()=>{});
      return res.status(200).json({ success:true, montantTotal, cashback });
    }

    if (action === "release_dispute") {
      const { mission_id } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,metier,sector`, { headers });
      const missions = await mr.json();
      const m = Array.isArray(missions) && missions[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (m.status !== "disputed") return res.status(400).json({ error: "La prestation n'est pas en litige" });

      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "completed" }),
      });

      // Notification client
      if (m.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.client_id, type:"system", title:"Litige résolu ✅", body:"ALANE a examiné votre dossier et a validé la prestation. Merci pour votre retour.", read:false }) }).catch(()=>{});
      }
      // Notification prestataire
      if (m.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.prestataire_id, type:"system", title:"Fonds libérés ✅", body:"Suite à l'examen du litige, votre prestation a été validée et les fonds libérés.", read:false }) }).catch(()=>{});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"release_dispute", target_id:mission_id }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "refund_dispute") {
      const { mission_id } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,stripe_payment_intent`, { headers });
      const missions = await mr.json();
      const m = Array.isArray(missions) && missions[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (m.status !== "disputed") return res.status(400).json({ error: "La prestation n'est pas en litige" });

      // Remboursement Stripe si un PaymentIntent existe
      if (m.stripe_payment_intent) {
        const stripeRes = await fetch(`https://api.stripe.com/v1/refunds`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${(process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "")}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: `payment_intent=${m.stripe_payment_intent}`,
        });
        if (!stripeRes.ok) {
          const stripeErr = await stripeRes.json().catch(() => ({}));
          return res.status(500).json({ error: stripeErr?.error?.message || "Erreur Stripe lors du remboursement" });
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "closed" }),
      });

      // Notification client
      if (m.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.client_id, type:"system", title:"Remboursement en cours 💰", body:"Votre litige a été accepté. Le remboursement sera crédité sous 5 à 10 jours ouvrés.", read:false }) }).catch(()=>{});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"refund_dispute", target_id:mission_id }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "manual_refund") {
      const { mission_id, reason } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,stripe_payment_intent`, { headers });
      const rows = await mr.json();
      const m = Array.isArray(rows) && rows[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (m.stripe_payment_intent) {
        const stripeRes = await fetch("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: { "Authorization": `Bearer ${(process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "")}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: `payment_intent=${m.stripe_payment_intent}`,
        });
        if (!stripeRes.ok) {
          const err = await stripeRes.json().catch(() => ({}));
          return res.status(500).json({ error: err?.error?.message || "Erreur Stripe" });
        }
      }
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, { method:"PATCH", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ status:"closed" }) });
      if (m.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.client_id, type:"system", title:"Remboursement initié 💰", body: reason || "Un remboursement a été initié par ALANE. Vous serez crédité sous 5 à 10 jours ouvrés.", read:false }) }).catch(()=>{});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"manual_refund", target_id:mission_id, details:{ reason } }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "cancel_mission") {
      const { mission_id, refund, reason } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,stripe_payment_intent`, { headers });
      const rows = await mr.json();
      const m = Array.isArray(rows) && rows[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (refund && m.stripe_payment_intent) {
        const stripeRes = await fetch("https://api.stripe.com/v1/refunds", { method:"POST", headers:{"Authorization":`Bearer ${(process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "")}`,"Content-Type":"application/x-www-form-urlencoded"}, body:`payment_intent=${m.stripe_payment_intent}` });
        if (!stripeRes.ok) { const err = await stripeRes.json().catch(()=>({})); return res.status(500).json({ error: err?.error?.message || "Erreur Stripe" }); }
      }
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, { method:"PATCH", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ status:"cancelled" }) });
      const notifs = [];
      if (m.client_id) notifs.push({ user_id:m.client_id, type:"system", title:"Prestation annulée", body:reason||(refund&&m.stripe_payment_intent?"Votre prestation a été annulée par ALANE. Un remboursement sera effectué sous 5-10 jours ouvrés.":"Votre prestation a été annulée par ALANE."), read:false });
      if (m.prestataire_id) notifs.push({ user_id:m.prestataire_id, type:"system", title:"Prestation annulée", body:reason||"Une prestation vous a été retirée par ALANE.", read:false });
      if (notifs.length) await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify(notifs) }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"cancel_mission", target_id:mission_id, details:{ reason, refund } }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "reassign_mission") {
      const { mission_id, new_presta_email, reason } = body;
      if (!mission_id || !new_presta_email) return res.status(400).json({ error: "mission_id + new_presta_email requis" });
      if (!isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,prestataire_id,client_id`, { headers });
      const rows = await mr.json();
      const m = Array.isArray(rows) && rows[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      // Trouver le nouveau prestataire par email
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers });
      const authData = await authRes.json();
      const newUser = (authData.users||[]).find(u => u.email === new_presta_email.trim());
      if (!newUser) return res.status(404).json({ error: "Prestataire introuvable avec cet email" });
      const old_presta = m.prestataire_id;
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, { method:"PATCH", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ prestataire_id:newUser.id, status:"assigned", validation_prestataire:false, validation_client:false }) });
      if (old_presta && old_presta !== newUser.id) await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:old_presta, type:"system", title:"Prestation réassignée", body:reason||"Une prestation vous a été retirée et réassignée à un autre prestataire.", read:false }) }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:newUser.id, type:"mission", title:"Nouvelle prestation assignée ✅", body:reason||"Une prestation vous a été assignée directement par ALANE.", read:false }) }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"reassign_mission", target_id:mission_id, details:{ old_presta, new_presta:newUser.id, reason } }) }).catch(()=>{});
      return res.status(200).json({ success: true, new_presta_name:`${newUser.user_metadata?.prenom||""} ${newUser.user_metadata?.nom||""}`.trim()||new_presta_email });
    }

    if (action === "update_mission") {
      const { mission_id, date, hours, tarif_horaire, ville, metier } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      const updates = {};
      if (date !== undefined && date !== "") updates.date = date;
      if (hours !== undefined && hours !== "") updates.hours = Number(hours);
      if (tarif_horaire !== undefined && tarif_horaire !== "") updates.tarif_horaire = Number(tarif_horaire);
      if (ville !== undefined && ville !== "") updates.ville = ville;
      if (metier !== undefined && metier !== "") updates.metier = metier;
      if (!Object.keys(updates).length) return res.status(400).json({ error: "Aucun champ à modifier" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, { method:"PATCH", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify(updates) });
      if (!r.ok) return res.status(500).json({ error: "Erreur mise à jour" });
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"update_mission", target_id:mission_id, details:updates }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "adjust_cashback") {
      const { profileId, delta, reason } = body;
      if (!profileId || delta == null) return res.status(400).json({ error: "profileId + delta requis" });
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, { method:"POST", headers:{...headers,"Prefer":"return=representation"}, body: JSON.stringify({ p_user_id:profileId, p_delta:Number(delta), p_missions:0 }) }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:profileId, type:"cashback", title: Number(delta) >= 0 ? `Cashback crédité +${Math.abs(Number(delta)).toFixed(2)} €` : `Cashback ajusté ${Number(delta).toFixed(2)} €`, body: reason || "Ajustement par l'administration ALANE.", read:false }) }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"adjust_cashback", target_id:profileId, details:{ delta, reason } }) }).catch(()=>{});
      return res.status(200).json({ ok: true });
    }

    if (action === "broadcast_notification") {
      const { title, body: notifBody, target } = body;
      if (!title || !notifBody) return res.status(400).json({ error: "title + body requis" });
      const roleFilter = target === "clients" ? "&role=eq.client" : target === "prestataires" ? "&role=eq.prestataire" : "";
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id${roleFilter}&status=eq.approved`, { headers });
      const profs = await pr.json();
      if (!Array.isArray(profs) || profs.length === 0) return res.status(200).json({ ok:true, sent:0 });
      const notifs = profs.map(p => ({ user_id:p.id, type:"system", title, body:notifBody, read:false }));
      for (let i = 0; i < notifs.length; i += 100) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify(notifs.slice(i, i+100)) }).catch(()=>{});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"broadcast_notification", details:{ title, target, count:notifs.length } }) }).catch(()=>{});
      return res.status(200).json({ ok:true, sent:notifs.length });
    }

    // Détection des schémas de mise à disposition (CGPS art. 10B).
    //
    // Ce qui est interdit n'est pas d'intervenir chez un tiers — c'est licite — mais
    // de fournir une personne nommément désignée, à l'heure, à un tiers qui la dirige.
    // Aucun de ces indices ne prouve quoi que ce soit isolément : ils servent à savoir
    // à qui demander des explications, conformément à l'escalade prévue au 10B.4.
    //
    // Trois signaux, tirés des données déjà présentes :
    //   • le lieu d'intervention diffère de la ville déclarée par le client ;
    //   • les prestations se répètent au même endroit, hors de chez lui ;
    //   • elles sont ponctuelles et visent des prestataires nommément choisis.
    // Traitement d'un signal de conformité, consigné dans bo_logs.
    //
    // Une détection qui tourne sans que personne n'agisse est pire que pas de
    // détection du tout : elle établit que la plateforme savait. La trace de ce qui a
    // été fait — et quand — est ce qui distingue une plateforme diligente d'une
    // plateforme complice.
    if (action === "traiter_signal") {
      const { clientId, decision, note } = req.body || {};
      if (!isUuidId(clientId)) return res.status(400).json({ error: "clientId invalide" });
      const DECISIONS = ["explications_demandees", "justificatifs_recus", "conforme", "suspendu", "sans_suite"];
      if (!DECISIONS.includes(decision)) return res.status(400).json({ error: "Décision inconnue" });
      const commentaire = String(note || "").trim().replace(/\s+/g, " ").slice(0, 500) || null;
      if (decision === "sans_suite" && !commentaire) {
        return res.status(400).json({ error: "Classer sans suite demande un motif écrit." });
      }

      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({
          action: `conformite_${decision}`,
          target_id: clientId,
          reason: commentaire,
        }),
      });
      const rows = await insRes.json().catch(() => null);
      if (!insRes.ok || !Array.isArray(rows) || rows.length === 0) {
        console.error(`[traiter_signal] enregistrement refusé pour ${clientId} : ${insRes.status} ${JSON.stringify(rows || {})}`);
        return res.status(500).json({ error: "La décision n'a pas pu être consignée. Réessayez." });
      }
      return res.status(200).json({ ok: true });
    }

    // Historique des décisions de conformité prises sur un client.
    if (action === "historique_conformite") {
      const { clientId } = req.body || {};
      if (!isUuidId(clientId)) return res.status(400).json({ error: "clientId invalide" });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/bo_logs?target_id=eq.${clientId}&action=like.conformite_*&select=action,reason,created_at&order=created_at.desc&limit=20`,
        { headers }
      );
      const l = await r.json().catch(() => []);
      return res.status(200).json(Array.isArray(l) ? l : []);
    }

    if (action === "signaux_mise_a_disposition") {
      const mrs = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?select=id,client_id,prestataire_id,ville,adresse,date,hours,status,tiers_declaration&order=created_at.desc&limit=1000`,
        { headers }
      );
      const toutes = await mrs.json().catch(() => []);
      if (!Array.isArray(toutes) || toutes.length === 0) return res.status(200).json([]);

      const clientIds = [...new Set(toutes.map(m => m.client_id).filter(Boolean))];
      if (!clientIds.length) return res.status(200).json([]);

      const prs = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=in.(${clientIds.join(",")})&role=eq.client&select=id,prenom,nom,ville`,
        { headers }
      );
      const profils = await prs.json().catch(() => []);
      const parClient = Object.fromEntries((Array.isArray(profils) ? profils : []).map(p => [p.id, p]));

      // La ville du compte peut n'exister que dans user_metadata pour les comptes anciens.
      let metaVille = {};
      try {
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers });
        const ud = await ur.json();
        for (const u of (ud.users || [])) {
          const v = u.user_metadata?.ville;
          if (v) metaVille[u.id] = v;
        }
      } catch (e) {
        console.error("[signaux] villes user_metadata illisibles :", e.message);
      }

      const norm = v => String(v || "").trim().toLowerCase().replace(/[\s-]+/g, " ");
      const resultat = [];

      for (const cid of clientIds) {
        const prof = parClient[cid];
        if (!prof) continue;                       // comptes prestataires ignorés
        const villeCompte = norm(prof.ville || metaVille[cid]);
        const siennes = toutes.filter(m => m.client_id === cid);
        if (siennes.length < 3) continue;          // trop peu pour dégager un schéma

        // Une adresse différente de celle du compte ne signifie pas qu'on intervient
        // chez un tiers : une entreprise multi-sites commande légitimement ailleurs.
        // Seules comptent les prestations pour lesquelles le client n'a RIEN déclaré.
        // Celles déclarées — « chez un tiers » comme « dans mon entreprise » — sont
        // écartées : la question a été posée et une réponse a été donnée.
        const horsVille = villeCompte
          ? siennes.filter(m => m.ville && norm(m.ville) !== villeCompte && !m.tiers_declaration)
          : [];
        if (!horsVille.length) continue;

        // Concentration : un même lieu revient-il ?
        const parLieu = {};
        for (const m of horsVille) {
          const cle = norm([m.adresse, m.ville].filter(Boolean).join(" "));
          if (!cle) continue;
          parLieu[cle] = (parLieu[cle] || 0) + 1;
        }
        const [lieuTop, occurrences] = Object.entries(parLieu).sort((a, b) => b[1] - a[1])[0] || [null, 0];

        const prestatairesDistincts = new Set(horsVille.map(m => m.prestataire_id).filter(Boolean)).size;
        const dureeMoyenne = horsVille.reduce((s2, m) => s2 + (Number(m.hours) || 0), 0) / horsVille.length;

        // Seuils délibérément bas : l'objet est de déclencher une question, pas une sanction.
        if (occurrences < 3) continue;

        // Une déclaration au titre du 10B change la lecture du signal : le client a
        // qualifié sa mission au lieu de commander une présence. Ce n'est pas un
        // blanc-seing, mais c'est exactement ce que la clause cherche à obtenir.
        // Compté sur l'ensemble des prestations du client, pas sur les seules
        // non déclarées — qui par construction n'en portent aucune.
        const declarees = siennes.filter(m => m.tiers_declaration).length;
        const exemple = (siennes.find(m => m.tiers_declaration?.beneficiaire) || {}).tiers_declaration || null;

        resultat.push({
          declarations: declarees,
          exemple_declaration: exemple,
          client_id: cid,
          client: [prof.prenom, prof.nom].filter(Boolean).join(" ") || cid,
          ville_compte: prof.ville || metaVille[cid] || null,
          lieu_recurrent: lieuTop,
          interventions_hors_ville: horsVille.length,
          occurrences_meme_lieu: occurrences,
          prestataires_distincts: prestatairesDistincts,
          duree_moyenne_h: Math.round(dureeMoyenne * 10) / 10,
          total_prestations: siennes.length,
        });
      }

      resultat.sort((a, b) => b.occurrences_meme_lieu - a.occurrences_meme_lieu);
      return res.status(200).json(resultat);
    }

    if (action === "list_ratings") {
      const rr = await fetch(`${SUPABASE_URL}/rest/v1/ratings?select=id,rating,comment,created_at,reviewer_id,reviewee_id&order=created_at.desc&limit=200`, { headers });
      const ratings = await rr.json();
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,prenom,nom`, { headers });
      const profs = await pr.json();
      const nameMap = {};
      (Array.isArray(profs) ? profs : []).forEach(p => { nameMap[p.id] = `${p.prenom||""} ${p.nom||""}`.trim(); });
      return res.status(200).json((Array.isArray(ratings) ? ratings : []).map(r => ({ ...r, reviewer_name: nameMap[r.reviewer_id]||"Inconnu", reviewee_name: nameMap[r.reviewee_id]||"Inconnu" })));
    }

    if (action === "delete_rating") {
      const { ratingId } = body;
      if (!ratingId) return res.status(400).json({ error: "ratingId requis" });
      if (!isUuidId(ratingId)) return res.status(400).json({ error: "ratingId invalide" });
      await fetch(`${SUPABASE_URL}/rest/v1/ratings?id=eq.${ratingId}`, { method:"DELETE", headers:{...headers,"Prefer":"return=minimal"} });
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"delete_rating", target_id:ratingId }) }).catch(()=>{});
      return res.status(200).json({ ok:true });
    }

    if (action === "list_missions_export") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?select=id,status,sector,metier,date,hours,tarif_horaire,montant_total,created_at,client_id,prestataire_id,stripe_payment_intent&order=created_at.desc`,
        { headers }
      );
      const missions = await r.json();
      return res.status(200).json(Array.isArray(missions) ? missions : []);
    }

    if (action === "bo_log_export") {
      const { details } = body;
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "export_csv", details: details || null }),
      }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (action === "reset_visits") {
      await fetch(`${SUPABASE_URL}/rest/v1/visits?id=neq.00000000-0000-0000-0000-000000000000`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      return res.status(200).json({ success: true });
    }

    if (action === "update_profile") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });

      const PROFILE_COLS = ["prenom", "nom", "status"];
      const VALID_STATUSES = ["pending", "approved", "rejected"];
      const VALID_PLANS = ["free", "premium", "elite"];
      const META_WHITELIST = ["secteur","metier","niveau","tarif_net","langues","dispon_jours","dispon_jours_creneaux","dispo_immediat","code_postal","ville","telephone","cv","zone_km","statut_pro","experience_ans","competences","plan_abonnement","subscription_end_date"];
      // plan_abonnement doit être mis à jour dans les deux tables
      const BOTH_COLS = ["plan_abonnement"];
      const profileFields = {};
      const metaFields = {};
      for (const [k, v] of Object.entries(payload)) {
        if (BOTH_COLS.includes(k)) { profileFields[k] = v; metaFields[k] = v; }
        else if (PROFILE_COLS.includes(k)) profileFields[k] = v;
        else if (META_WHITELIST.includes(k)) metaFields[k] = v;
      }
      if (profileFields.plan_abonnement !== undefined && !VALID_PLANS.includes(profileFields.plan_abonnement)) {
        return res.status(400).json({ error: "Plan invalide" });
      }
      // Réinitialiser trial_exhausted quand on passe sur un plan payant
      if (profileFields.plan_abonnement && profileFields.plan_abonnement !== "free") {
        profileFields.trial_exhausted = false;
      }
      if (profileFields.status !== undefined && !VALID_STATUSES.includes(profileFields.status)) {
        return res.status(400).json({ error: "Statut invalide" });
      }

      if (Object.keys(profileFields).length > 0) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify(profileFields),
        });
        if (!r.ok) return res.status(500).json({ error: "Erreur mise à jour profil" });
      }

      if (Object.keys(metaFields).length > 0) {
        const getR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
        const existingUser = getR.ok ? await getR.json() : {};
        const existingMeta = existingUser.user_metadata || {};
        const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ user_metadata: { ...existingMeta, ...metaFields } }),
        });
        if (!r.ok) return res.status(500).json({ error: "Erreur mise à jour métadonnées" });
      }

      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "update_profile", target_id: profileId }),
      }).catch(() => {});

      return res.status(200).json({ success: true });
    }

    // Force-écrase plan dans profiles + user_metadata, ignore Stripe
    if (action === "repair_plan") {
      if (!profileId || !body.plan) return res.status(400).json({ error: "profileId + plan requis" });
      const plan = body.plan;
      if (!["free","premium","elite"].includes(plan)) return res.status(400).json({ error: "Plan invalide" });
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
        method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ plan_abonnement: plan, trial_exhausted: false }),
      });
      if (!patchRes.ok) {
        const patchErr = await patchRes.text().catch(()=>"");
        console.error("[repair_plan] PATCH profiles failed:", patchRes.status, patchErr);
        return res.status(500).json({ error: "Échec mise à jour profiles", detail: patchErr });
      }
      const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      if (uRes.ok) {
        const uData = await uRes.json();
        const uPutRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, {
          method: "PUT", headers,
          body: JSON.stringify({ user_metadata: { ...(uData.user_metadata || {}), plan_abonnement: plan } }),
        });
        if (!uPutRes.ok) {
          const uPutErr = await uPutRes.text().catch(()=>"");
          console.error("[repair_plan] PUT user_metadata failed:", uPutRes.status, uPutErr);
        }
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"repair_plan", target_id:profileId, details:{ plan } }) }).catch(()=>{});
      return res.status(200).json({ success: true, plan });
    }

    if (action === "list_logs") {
      const logsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bo_logs?order=created_at.desc&limit=200`,
        { headers }
      );
      const logs = await logsRes.json();
      return res.status(200).json(Array.isArray(logs) ? logs : []);
    }

    if (action === "stripe_stats") {
      const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
      if (!STRIPE_KEY) {
        return res.status(200).json({ error: "Stripe non configuré" });
      }
      const stripeAuth = "Basic " + Buffer.from(STRIPE_KEY + ":").toString("base64");
      const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

      const [balanceRes, chargesRes] = await Promise.all([
        fetch("https://api.stripe.com/v1/balance", {
          headers: { "Authorization": stripeAuth },
        }),
        fetch(`https://api.stripe.com/v1/charges?limit=100&created[gte]=${thirtyDaysAgo}`, {
          headers: { "Authorization": stripeAuth },
        }),
      ]);

      if (!balanceRes.ok || !chargesRes.ok) {
        return res.status(200).json({ error: "Erreur Stripe API" });
      }

      const balanceData = await balanceRes.json();
      const chargesData = await chargesRes.json();

      const available = (balanceData.available || []).reduce((acc, b) => acc + (b.amount || 0), 0) / 100;
      const pending   = (balanceData.pending   || []).reduce((acc, b) => acc + (b.amount || 0), 0) / 100;

      const charges = Array.isArray(chargesData.data) ? chargesData.data : [];
      const succeeded = charges.filter(c => c.status === "succeeded");
      const volume = succeeded.reduce((acc, c) => acc + (c.amount || 0), 0) / 100;
      const commission = Math.round(volume * 0.20 * 100) / 100;

      return res.status(200).json({
        available: Math.round(available * 100) / 100,
        pending:   Math.round(pending   * 100) / 100,
        last30days: {
          count:      succeeded.length,
          volume:     Math.round(volume     * 100) / 100,
          commission: commission,
        },
      });
    }

    if (action === "list_paid_missions") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?stripe_payment_intent=not.is.null&status=eq.completed&select=id,montant_total,stripe_payment_intent,created_at,sector,metier&order=created_at.desc&limit=50`,
        { headers }
      );
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (action === "get_settings") {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?select=key,value`, { headers });
      const rows = await r.json();
      if (!Array.isArray(rows)) return res.status(200).json({});
      const obj = {};
      for (const row of rows) obj[row.key] = row.value;
      return res.status(200).json(obj);
    }

    if (action === "save_settings") {
      if (!verifyBoToken(req.headers["authorization"])) return res.status(401).json({ error: "Non autorisé" });
      const { key, value } = payload;
      if (!key || value === undefined) return res.status(400).json({ error: "key et value requis" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings`, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) return res.status(500).json({ error: "Erreur sauvegarde" });
      return res.status(200).json({ ok: true });
    }

    if (action === "seed_docs") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const DEMO_DOCS = [
        { type:"photo",    storage_path:`demo/${profileId}/photo_profil.jpg` },
        { type:"cni",      storage_path:`demo/${profileId}/piece_identite.pdf` },
        { type:"kbis",     storage_path:`demo/${profileId}/kbis_siret.pdf` },
        { type:"urssaf",   storage_path:`demo/${profileId}/attestation_urssaf.pdf` },
        { type:"rib",      storage_path:`demo/${profileId}/rib_iban.pdf` },
        { type:"domicile", storage_path:`demo/${profileId}/justif_domicile.pdf` },
        { type:"rc_pro",   storage_path:`demo/${profileId}/rc_professionnelle.pdf` },
      ];
      const inserts = DEMO_DOCS.map(d => ({
        prestataire_id: profileId,
        type: d.type,
        storage_path: d.storage_path,
        verified: true,
      }));
      const r = await fetch(`${SUPABASE_URL}/rest/v1/documents?on_conflict=prestataire_id,type`, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(inserts),
      });
      if (!r.ok) {
        const err = await r.text();
        return res.status(500).json({ error: `Erreur insertion: ${err}` });
      }
      return res.status(200).json({ ok: true, inserted: inserts.length });
    }

    return res.status(400).json({ error: "Action invalide" });
  } catch (e) {
    console.error("bo-action error:", e);
    return res.status(500).json({ error: `Erreur serveur: ${e?.message || String(e)}` });
  }
}
