import { notifier, sendPushToUser } from "./_push.js";
import crypto from "crypto";
import { esc, hashPii, emailHtml, sendEmail } from "./_email.js";
import { couplesADependance, SEUILS_PAR_DEFAUT, analyserContinuite } from "./_dependance.js";
import { sendWebPush } from "./_push.js";

/** Hôte lisible d'une adresse d'abonnement, sans exposer le jeton complet. */
const hoteDe = (url) => { try { return new URL(url).host; } catch { return "adresse illisible"; } };
import { montantsDeCloture } from "./_cloture.js";
import { dateExigibilite } from "./_creances.js";
import { echeanceVersementMs } from "./_temps.js";
import { RESOLUTIONS, libelleResolution, echeanceOppositionMs, executerResolution } from "./_resolution.js";
import { assurerCompteConnect, lienConfiguration } from "./_connect.js";
import { appUrl } from "./_url.js";

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

  // ── Journal du backoffice ─────────────────────────────────────────
  //
  // La plupart des actions destructrices étaient déjà tracées, mais sept ne
  // l'étaient pas — dont la validation des pièces d'identité et la modification
  // des réglages de la plateforme.
  //
  // Deux conséquences. D'abord la conformité : après tout le travail sur la
  // vigilance (art. 10B et 10D), ne pas pouvoir répondre à « qui a validé ce
  // SIRET, et quand ? » vide le dispositif de sa substance. Ensuite l'argent :
  // les frais de service, les taux de cashback et les seuils vivent dans
  // `platform_settings`, et rien ne disait qui les avait changés.
  //
  // L'échec d'écriture n'interrompt jamais l'action — un journal indisponible
  // ne doit pas empêcher de valider un document — mais il est signalé.
  // Le `.catch()` seul n'attrapait QUE les erreurs réseau. Un refus de
  // PostgREST — colonne inconnue, contrainte violée — résout normalement, et
  // l'échec passait donc inaperçu : `bo_logs.details` n'existait pas, et
  // aucune action du backoffice qui en transportait un n'a jamais été
  // journalisée. Les plus sensibles sont précisément celles-là.
  const journaliser = async (act, champs = {}) => {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: act, ...champs }),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        console.error(`[bo_logs] ${act} NON journalisé (${r.status}) : ${detail.slice(0, 200)}`);
      }
    } catch (e) {
      console.error(`[bo_logs] ${act} non journalisé :`, e.message);
    }
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
        // L'IBAN ne quitte plus le serveur dans la liste.
        //
        // `list` renvoyait l'IBAN complet, en clair, de TOUS les comptes, à chaque
        // ouverture du backoffice. Une seule fiche est consultée à la fois : il
        // n'y a aucune raison d'envoyer au navigateur les coordonnées bancaires
        // de tout le monde. La minimisation des données (RGPD art. 5.1.c) impose
        // le contraire, et une session compromise emportait jusqu'ici l'ensemble
        // du fichier bancaire.
        //
        // Seuls partent : la présence d'un IBAN, et ses quatre derniers
        // caractères, qui suffisent à distinguer deux comptes à l'écran. La
        // valeur complète s'obtient une fiche à la fois par l'action
        // `reveal_iban`, qui laisse une trace.
        const ribComplet = p.rib || meta.rib || null;
        const ribNettoye = ribComplet ? String(ribComplet).replace(/\s/g, "").toUpperCase() : null;
        return {
          ...p,
          email,
          ...exposedMeta,
          rib: null,
          rib_present: !!ribNettoye,
          rib_fin: ribNettoye ? ribNettoye.slice(-4) : null,
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

      // Approuver un prestataire lui ouvre l'accès au travail ; le refuser le lui
      // ferme. Ni l'un ni l'autre ne laissait de trace. Le contrôle du SIRET
      // effectué juste au-dessus n'était journalisé que dans la console Vercel,
      // effacée au bout de quelques jours : sa conclusion est consignée ici.
      journaliser(action, {
        target_id: profileId,
        target_email: userEmail || null,
        details: action === "approve"
          ? { siret: (userData.user_metadata?.siret || userData.user_metadata?.kbis || null) }
          : null,
      });

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

      // ── Le compte de virement n'est PLUS créé ici ────────────────────
      //
      // Il l'était, et le lien de configuration partait dans l'e-mail de
      // bienvenue. Trop tôt : ce lien expire en vingt-quatre heures, et valider
      // un compte ne dit rien de l'état du dossier. Entre la validation et le
      // moment où le prestataire est réellement prêt, il peut s'écouler des
      // jours — le lien mourait avant d'avoir servi, et rien ne le remplaçait.
      //
      // Il part désormais à l'ouverture de l'accès aux prestations
      // (`enable_missions`), qui signifie que le dossier est complet.
      const role = userData.user_metadata?.role;

      if (userEmail) {
        if (status === "approved") {
          const prenom = userData.user_metadata?.prenom || "";
          await sendEmail({
            to: userEmail,
            subject: "Bienvenue sur ALANE — Votre compte est activé ! 🎉",
            html: emailHtml(`
              <p>Bonjour${prenom ? ` <strong>${esc(prenom)}</strong>` : ""},</p>
              <p>Bonne nouvelle ! 🎉 Votre compte <strong>ALANE</strong> a été validé par notre équipe.</p>
              ${role === "prestataire" ? `
              <p style="margin-top:20px;">Prochaine étape : déposez vos documents justificatifs depuis votre espace. Une fois votre dossier vérifié, nous vous ouvrirons l'accès aux prestations et vous enverrons le lien pour configurer vos virements.</p>
              ` : ""}
              <p>Vous pouvez dès maintenant vous connecter et commencer à utiliser ALANE.</p>
              <p style="text-align:center;margin:28px 0;"><a href='${appUrl()}' style="background:#7C6FE0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Accéder à ALANE →</a></p>
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
      // `missions_enabled_at` marque l'entrée dans les 100 places de l'offre de
      // lancement. On ne l'écrit QUE si elle est vide : une suspension suivie
      // d'une réouverture ne doit pas coûter sa place à quelqu'un qui l'avait,
      // ni le replacer derrière ceux arrivés entre-temps.
      const majProfil = { missions_enabled: enabled };
      if (enabled) {
        const dRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}&select=missions_enabled_at`,
          { headers }
        );
        const dRows = dRes.ok ? await dRes.json().catch(() => []) : [];
        if (!(Array.isArray(dRows) && dRows[0]?.missions_enabled_at)) {
          majProfil.missions_enabled_at = new Date().toISOString();
        }
      }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(majProfil),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        console.error(`[enable_missions] écriture refusée (${r.status}) : ${detail.slice(0, 200)}`);
        return res.status(500).json({ error: "Erreur mise à jour missions_enabled" });
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action, target_id: profileId, details: { enabled } }),
      }).catch(() => {});

      // ── Le compte de virement se prépare ICI ────────────────────────
      //
      // Le lien de configuration partait à la VALIDATION DU COMPTE. C'était
      // trop tôt : celui de Stripe expire en vingt-quatre heures, et valider un
      // compte ne dit rien de l'état du dossier. Entre la validation et le
      // moment où le prestataire est réellement prêt, il peut s'écouler des
      // jours — le lien était mort avant d'avoir servi.
      //
      // Ouvrir l'accès aux prestations, au contraire, signifie que le dossier
      // est complet et vérifié : le prestataire va travailler, donc il doit
      // pouvoir être payé. C'est là que le lien a le plus de chances d'être
      // utilisé dans sa fenêtre de validité.
      //
      // Rien de tout cela ne bloque l'ouverture de l'accès : un e-mail qui
      // n'part pas ne doit pas empêcher quelqu'un de travailler. Les échecs
      // sont journalisés, et le prestataire garde le bouton de son espace.
      let virementsPretsAConfigurer = false;
      if (enabled) {
        const STRIPE_SK_M = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
        try {
          const pRes = await fetch(
            `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}&select=id,prenom,nom,stripe_account_id,stripe_account_status`,
            { headers }
          );
          const pRows = await pRes.json().catch(() => []);
          const profilPresta = Array.isArray(pRows) && pRows[0];
          if (!profilPresta) {
            console.error(`[connect] profil ${profileId} illisible — lien de virement non envoyé.`);
          } else if (profilPresta.stripe_account_status === "enabled") {
            // Déjà opérationnel : ne pas le renvoyer sur un formulaire qu'il a
            // rempli, ce serait lui faire croire qu'il a raté quelque chose.
            console.log(`[connect] ${profileId} a déjà un compte de virement actif — aucun lien envoyé.`);
          } else {
            const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
            const uData = await uRes.json().catch(() => ({}));
            const compte = await assurerCompteConnect({
              profil: profilPresta, email: uData?.email,
              supabaseUrl: SUPABASE_URL, headers, stripeKey: STRIPE_SK_M,
            });
            if (!compte.ok) {
              console.error(`[connect] compte non préparé pour ${profileId} : ${compte.detail}`);
            } else {
              const lien = await lienConfiguration({
                compteId: compte.compteId, stripeKey: STRIPE_SK_M,
                appUrl: appUrl(),
              });
              if (!lien.ok) {
                console.error(`[connect] lien non généré pour ${profileId} : ${lien.detail}`);
              } else if (uData?.email) {
                virementsPretsAConfigurer = true;
                await sendEmail({
                  to: uData.email,
                  subject: "Votre accès aux prestations est ouvert — configurez vos virements 🏦",
                  html: emailHtml(`
                    <p>Bonjour${uData.user_metadata?.prenom ? ` <strong>${esc(uData.user_metadata.prenom)}</strong>` : ""},</p>
                    <p>Votre dossier est complet : <strong>vous avez désormais accès aux prestations</strong> et pouvez recevoir vos premières propositions.</p>
                    <p style="margin-top:20px;">Dernière étape, et elle conditionne vos paiements : configurer votre compte de virement. Comptez deux minutes — votre IBAN, et les conditions de Stripe à signer.</p>
                    <p style="text-align:center;margin:24px 0;"><a href='${lien.url}' style="background:#10D98F;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Configurer mes virements →</a></p>
                    <p style="color:#888;font-size:13px;">Ce lien est valable 24 h. Passé ce délai, vous le retrouverez dans votre espace, onglet « Prestations » — vous pouvez le redemander autant de fois que nécessaire.</p>
                    <p style="color:#888;font-size:13px;">Sans cette configuration, vous pouvez accepter des prestations et les réaliser, mais aucun virement ne pourra vous être envoyé.</p>
                  `),
                });
              } else {
                console.error(`[connect] adresse e-mail introuvable pour ${profileId} — lien non envoyé.`);
              }
            }
          }
        } catch (e) {
          console.error(`[connect] préparation des virements interrompue pour ${profileId} :`, e.message);
        }
      }

      return res.status(200).json({ success: true, virementsPretsAConfigurer });
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

      // Versements encore dus au compte supprimé.
      //
      // Depuis que le virement est différé de 48 h après la fin (CGPS art. 17.1),
      // une prestation validée n'est plus payée dans la foulée. Supprimer un
      // prestataire fait donc disparaître son profil — donc son compte Stripe —
      // et la somme reste bloquée sans que personne ne s'en aperçoive.
      //
      // On ne bloque pas : supprimer un fraudeur sans le payer est précisément
      // l'usage attendu de cette action. Mais on le dit, plutôt que de le taire.
      let versementsDus = 0;
      try {
        const vRes = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${profileId}`
          + `&payout_status=in.(pending,processing)&status=eq.completed`
          + `&select=id,payout_amount`,
          { headers }
        );
        const vRows = vRes.ok ? await vRes.json().catch(() => []) : [];
        if (Array.isArray(vRows) && vRows.length) {
          versementsDus = vRows.reduce((t, m) => t + Number(m.payout_amount || 0), 0);
          console.warn(`[delete] ${vRows.length} versement(s) non émis pour ${profileId}, `
            + `${versementsDus.toFixed(2)} € au total — supprimés avec le compte. `
            + `Prestations : ${vRows.map(m => m.id).join(", ")}`);
        }
      } catch (e) {
        console.error("[delete] contrôle des versements dus impossible :", e.message);
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
              await notifier({
                  user_id: affectedClient,
                  type: "system",
                  title: "Prestation annulée — remboursement en cours",
                  body: `La prestation "${pm.metier || pm.sector || ""}" a été annulée suite à la fermeture du compte prestataire. Un remboursement automatique est en cours (5-10 jours ouvrés).`,
                }, SUPABASE_URL, headers).catch(() => {});
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
      return res.status(200).json({ success: true, versementsDus: Math.round(versementsDus * 100) / 100 });
    }

    if (action === "suspend") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      // Le motif est OBLIGATOIRE depuis la réécriture de l'article 16.2 : la
      // suspension conservatoire doit être « notifiée par écrit et motivée au
      // plus tard au moment où elle prend effet » (règlement P2B, art. 4). Il
      // était facultatif, et le courriel partait alors sans aucune explication —
      // le destinataire ne pouvait donc ni comprendre, ni contester utilement.
      const reason = (req.body.reason || "").trim();
      if (reason.length < 10) {
        return res.status(400).json({
          error: "Un motif d'au moins 10 caractères est requis : il est communiqué à l'intéressé, "
               + "qui doit pouvoir le contester (CGPS art. 16.2).",
        });
      }
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const userData = await userRes.json();
      const userEmail = userData.email;
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, { method:"PATCH", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ status:"suspended" }) });
      if (userEmail) {
        await sendEmail({
          to: userEmail,
          subject: "Votre compte ALANE a été suspendu",
          html: emailHtml(
            `<p>Bonjour,</p>`
            + `<p>Votre compte <strong>ALANE</strong> est suspendu à titre conservatoire, le temps de la vérification des faits.</p>`
            + `<p><strong>Motif :</strong> ${esc(reason)}</p>`
            + `<p>Conformément à l'article 16.2 des conditions, vous disposez de <strong>quinze jours</strong> pour `
            + `présenter vos observations à <strong>support@alane.fr</strong>. La suspension est levée sans délai `
            + `si le motif n'est pas établi.</p>`
          ),
        });
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"suspend", target_id:profileId, target_email:userEmail||null, reason:reason||null }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    // ── Résiliation avec préavis (CGPS art. 16.2, règlement P2B art. 4) ──
    //
    // Le règlement impose TRENTE JOURS de préavis avant de résilier le compte
    // d'un utilisateur professionnel. Le backoffice ne savait que supprimer
    // immédiatement : la clause promettait un délai que l'outil ne tenait pas.
    //
    // Le compte continue de fonctionner pendant le préavis — un préavis n'est
    // pas une suspension. Pour écarter quelqu'un tout de suite, c'est la
    // suspension conservatoire qui s'applique, et elle existe déjà.
    if (action === "programmer_resiliation") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const motif = (req.body.reason || "").trim();
      if (motif.length < 10) {
        return res.status(400).json({
          error: "Un motif d'au moins 10 caractères est requis : il est notifié à l'intéressé, "
               + "qui doit pouvoir le contester (CGPS art. 16.2).",
        });
      }
      // Trente jours au minimum. L'administrateur peut allonger, jamais réduire :
      // c'est un plancher réglementaire, pas un réglage de confort.
      const jours = Math.max(30, Number(req.body.jours) || 30);
      const effet = new Date(Date.now() + jours * 86400000);

      const maj = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
        method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({
          resiliation_prevue_at: effet.toISOString(),
          resiliation_motif: motif,
          resiliation_notifiee_at: new Date().toISOString(),
        }),
      });
      const rows = await maj.json().catch(() => []);
      if (!maj.ok || !Array.isArray(rows) || rows.length === 0) {
        console.error(`[programmer_resiliation] échec pour ${profileId} (${maj.status}) — vérifier `
          + "que la migration 2026-08-16_preavis_resiliation.sql est appliquée.");
        return res.status(503).json({ error: "Résiliation non programmée — migration non appliquée ?" });
      }

      const effetLe = effet.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
      const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const uData = await uRes.json().catch(() => ({}));
      if (uData?.email) {
        await sendEmail({
          to: uData.email,
          subject: `Résiliation de votre compte ALANE au ${effetLe}`,
          html: emailHtml(
            `<p>Bonjour,</p>`
            + `<p>Nous vous informons que votre compte <strong>ALANE</strong> sera résilié le `
            + `<strong>${esc(effetLe)}</strong>, soit dans ${jours} jours.</p>`
            + `<p><strong>Motif :</strong> ${esc(motif)}</p>`
            + `<p>Votre compte fonctionne normalement jusqu'à cette date : vous pouvez honorer vos `
            + `prestations en cours et percevoir les versements correspondants.</p>`
            + `<p>Vous pouvez contester cette décision en écrivant à <strong>support@alane.fr</strong>. `
            + `Votre demande sera examinée de façon contradictoire, et la résiliation annulée si le `
            + `motif n'est pas établi.</p>`
          ),
        }).catch(e => console.error(`[programmer_resiliation] e-mail NON envoyé à ${profileId} :`, e.message));
      }
      await notifier({ user_id: profileId, type: "system",
          title: "Résiliation de votre compte",
          body: `Votre compte sera résilié le ${effetLe}. Motif : ${motif}. `
              + `Vous pouvez contester à support@alane.fr — la décision est réexaminée de façon contradictoire.`}, SUPABASE_URL, headers).catch(() => {});

      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "programmer_resiliation", target_id: profileId, target_email: uData?.email || null, reason: motif }) }).catch(() => {});
      return res.status(200).json({ success: true, effet: effet.toISOString() });
    }

    if (action === "annuler_resiliation") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const maj = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}&resiliation_prevue_at=not.is.null`, {
        method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ resiliation_prevue_at: null, resiliation_motif: null, resiliation_notifiee_at: null }),
      });
      const rows = await maj.json().catch(() => []);
      if (!maj.ok || !Array.isArray(rows) || rows.length === 0) {
        return res.status(409).json({ error: "Aucune résiliation programmée sur ce compte." });
      }
      await notifier({ user_id: profileId, type: "system",
          title: "Résiliation annulée ✅",
          body: "Après examen, la résiliation de votre compte est annulée. Votre accès reste inchangé."}, SUPABASE_URL, headers).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "annuler_resiliation", target_id: profileId }) }).catch(() => {});
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
      await notifier({ user_id:profileId, type:"system", title:`Abonnement mis à jour → ${planLabel}`, body:end_date?`Votre abonnement ${planLabel} est actif jusqu'au ${new Date(end_date).toLocaleDateString("fr-FR")}.`:`Votre abonnement a été mis à jour vers ${planLabel}.`}, SUPABASE_URL, headers).catch(()=>{});
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
      const missionsRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?status=eq.disputed&select=id,metier,titre,date,montant_total,client_id,prestataire_id,stripe_payment_intent,resolution_proposee,resolution_motif,resolution_echeance_at,resolution_opposition_at,resolution_opposition_par,resolution_montant&order=created_at.desc`, { headers });
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
        } catch (e) { console.error("[bo-action] emails des participants illisibles :", e.message); }
      }

      const enriched = missions.map(m => ({
        ...m,
        client_email: emailMap[m.client_id] || null,
        presta_email: m.prestataire_id ? (emailMap[m.prestataire_id] || null) : null,
      }));
      return res.status(200).json(enriched);
    }

    // ── proposer_resolution : ALANE propose, elle ne décide pas ────────
    //
    // L'ancien `resolve_dispute` remboursait ou validait dans la seconde,
    // depuis le backoffice, sans que le client ni le prestataire aient été
    // consultés. L'article 17.1 ne le permet plus : ALANE formule une
    // proposition, la notifie aux deux parties, et attend. L'accord se forme
    // par l'absence d'opposition dans les 48 heures ; l'exécution revient
    // alors au traitement automatique.
    //
    // Rien ne bouge ici du côté de l'argent. C'est le point de tout ce bloc.
    if (action === "proposer_resolution") {
      const { mission_id, resolution, motif, montant } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      if (!RESOLUTIONS.includes(resolution)) {
        return res.status(400).json({ error: `resolution invalide (${RESOLUTIONS.join("|")})` });
      }
      // Le motif est notifié aux parties : sans lui, l'opposition se décide à
      // l'aveugle et la proposition n'est pas contradictoire.
      const motifPropre = String(motif || "").trim();
      if (motifPropre.length < 10) {
        return res.status(400).json({ error: "Motif requis (10 caractères minimum) — il est communiqué aux deux parties." });
      }

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,metier,titre,montant_total,resolution_proposee`, { headers });
      const rows = await mr.json();
      const m = Array.isArray(rows) && rows[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (m.status !== "disputed") return res.status(400).json({ error: "La prestation n'est pas en litige" });
      if (m.resolution_proposee) {
        return res.status(409).json({ error: "Une proposition court déjà sur cette prestation." });
      }

      // Montant du remboursement. Facultatif : sans lui, la proposition porte
      // sur le prix de la prestation, frais de service retenus — le
      // comportement d'avant.
      //
      // La plupart des litiges réels sont partiels (deux heures sur trois
      // faites, une partie du travail à refaire). Sans montant intermédiaire,
      // l'arbitre n'avait que « tout » ou « rien » et devait choisir celui qui
      // lésait le moins mal, ce qui n'est pas une décision.
      //
      // Sur un versement au prestataire, le montant n'a pas de sens : le
      // prestataire touche sa rémunération, calculée à la clôture.
      let montantPropose = null;
      if (resolution === "rembourser_client" && montant !== undefined && montant !== null && montant !== "") {
        const brut = Number(String(montant).replace(",", "."));
        if (!Number.isFinite(brut) || brut <= 0) {
          return res.status(400).json({ error: "Montant invalide — indiquez une somme supérieure à 0, ou laissez vide pour le remboursement par défaut." });
        }
        const plafond = Number(m.montant_total || 0);
        montantPropose = Math.round(brut * 100) / 100;
        // On ne peut pas rendre plus que ce que le client a payé : Stripe le
        // refuserait, et le refus arriverait APRÈS la clôture du litige.
        if (plafond > 0 && montantPropose > plafond + 0.001) {
          return res.status(400).json({ error: `Montant supérieur à ce que le client a réglé (${plafond.toFixed(2)} €).` });
        }
      }

      const maintenant = Date.now();
      const echeance   = echeanceOppositionMs(maintenant);
      const up = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          resolution_proposee:    resolution,
          resolution_motif:       motifPropre,
          resolution_montant:     montantPropose,
          resolution_notifiee_at: new Date(maintenant).toISOString(),
          resolution_echeance_at: new Date(echeance).toISOString(),
        }),
      });
      if (!up.ok) {
        const detail = await up.text().catch(() => "");
        console.error(`[proposer_resolution] enregistrement refusé (${up.status}) : ${detail.slice(0, 200)}`);
        return res.status(500).json({ error: "La proposition n'a pas pu être enregistrée." });
      }

      // Les deux parties reçoivent le MÊME texte : la proposition, son motif,
      // la date limite et le moyen de s'y opposer. C'est cette notification
      // qui fait courir le délai — sans elle, le silence ne vaudrait rien.
      const quoi  = montantPropose !== null
        ? `rembourser ${montantPropose.toFixed(2).replace(".", ",")} € au client`
        : libelleResolution(resolution);
      const limite = new Date(echeance).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });
      const detailFrais = resolution !== "rembourser_client"
        ? ""
        : montantPropose !== null
          ? " Ce montant est un remboursement partiel : il tient compte de ce qui a été effectivement réalisé."
          : " Le remboursement porterait sur le prix de la prestation, les frais de service restant acquis à ALANE (article 17.1 des CGPS).";
      const corps = `Après examen du litige sur « ${m.titre || m.metier || "votre prestation"} », ALANE propose de ${quoi}.${detailFrais}\n\nMotif : ${motifPropre}\n\nCette proposition ne tranche pas le litige et ne vous est pas imposée. Si vous ne vous y opposez pas avant le ${limite}, elle sera considérée comme acceptée par les deux parties et exécutée. Vous pouvez vous y opposer en un clic depuis la prestation, sans avoir à vous justifier.`;
      for (const uid of [m.client_id, m.prestataire_id]) {
        if (!uid) continue;
        // `type: "mission"` avec `ref_id`, et non `type: "system"` : c'est le
        // routage des notifications. Une notification « système » sans
        // référence renvoyait le client vers l'écran de RECHERCHE — il
        // touchait « Proposition de résolution » et atterrissait sur la liste
        // des prestataires. Avec le type et la référence justes, elle ouvre la
        // prestation concernée, où vit le bloc de proposition.
        await notifier({ user_id: uid, type: "mission", ref_id: mission_id, title: "Proposition de résolution 📩", body: corps}, SUPABASE_URL, headers).catch(e => console.error("[proposer_resolution] notification non envoyée :", e.message));
      }

      journaliser("proposer_resolution", { target_id: mission_id, details: { resolution, motif: motifPropre, montant: montantPropose } });
      return res.status(200).json({ success: true, echeance: new Date(echeance).toISOString() });
    }

    // ── executer_decision : les deux autres causes de l'article 17.1 ───
    //
    // Une décision de justice, ou une procédure du prestataire de services de
    // paiement (rétrofacturation, fraude), dénouent le litige sans passer par
    // l'accord des parties. ALANE ne fait alors que constater et transmettre.
    //
    // La justification est obligatoire et journalisée : c'est la seule chose
    // qu'on pourra produire si l'on demande un jour au titre de quoi les fonds
    // ont bougé sans accord.
    if (action === "executer_decision") {
      const { mission_id, resolution, cause, justification } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      if (!RESOLUTIONS.includes(resolution)) {
        return res.status(400).json({ error: `resolution invalide (${RESOLUTIONS.join("|")})` });
      }
      if (!["justice", "psp"].includes(cause)) {
        return res.status(400).json({ error: "cause invalide (justice|psp)" });
      }
      const just = String(justification || "").trim();
      if (just.length < 10) {
        return res.status(400).json({ error: "Justification requise (10 caractères minimum) — référence de la décision ou du dossier." });
      }

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,metier,titre,stripe_payment_intent,montant_total,tarif_horaire,hours,actual_hours,date_debut,date_fin,delay_status,arrival_delay_minutes,resolution_montant`, { headers });
      const rows = await mr.json();
      const m = Array.isArray(rows) && rows[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (m.status !== "disputed") return res.status(400).json({ error: "La prestation n'est pas en litige" });

      const out = await executerResolution({
        mission: m, resolution, supabaseUrl: SUPABASE_URL, headers,
        stripeKey: (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, ""),
        cause,
      });
      if (!out.ok) return res.status(500).json({ error: out.detail });

      const quoi = libelleResolution(resolution);
      const origine = cause === "justice" ? "d'une décision de justice" : "d'une procédure de l'établissement de paiement";
      // Cf. cron : l'écart entre le montant payé et le montant remboursé doit
      // être annoncé, pas découvert sur le relevé bancaire.
      const reliquat = Number(out.versementPrestataire || 0);
      const precision = resolution !== "rembourser_client" ? "" :
        "\n\nLe remboursement porte sur le prix de la prestation ; les frais de service restent acquis à ALANE (article 17.1 des CGPS)."
        + (reliquat > 0
            ? `\n\nLa part de la prestation qui n'a pas été remboursée, soit ${reliquat.toFixed(2).replace(".", ",")} €, est versée au prestataire.`
            : "");
      for (const uid of [m.client_id, m.prestataire_id]) {
        if (!uid) continue;
        await notifier({ user_id: uid, type: "mission", ref_id: mission_id, title: "Litige dénoué ⚖️", body: `Le litige sur « ${m.titre || m.metier || "votre prestation"} » a été dénoué en application ${origine} : ALANE a transmis l'instruction de ${quoi}.${precision}\n\nRéférence : ${just}`}, SUPABASE_URL, headers).catch(e => console.error("[executer_decision] notification non envoyée :", e.message));
      }

      journaliser("executer_decision", { target_id: mission_id, details: { resolution, cause, justification: just } });
      return res.status(200).json({ success: true, statut: out.statut });
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
      journaliser("delete_ticket", { target_id: String(req.body.ticketId ?? req.body.id ?? "") || null });
      return res.status(200).json({ success: true });
    }

    if (action === "send_global_comm") {
      const message = req.body.message || "";
      if (!message.trim()) return res.status(400).json({ error: "Message requis" });

      // Seuls les prestataires ayant CONSENTI aux communications commerciales.
      //
      // Cet envoi relève de la prospection, et l'article L.34-5 du Code des
      // postes et des communications électroniques la subordonne au
      // consentement préalable de la personne physique. Il partait auparavant à
      // tous les prestataires approuvés, sans que personne n'ait rien accepté.
      //
      // Les messages transactionnels — confirmation, rappel, validation,
      // versement — ne passent pas par ici : ils relèvent de l'exécution du
      // contrat et ne sont pas concernés.
      const [profilesRes, authRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&role=eq.prestataire&status=eq.approved&accepte_communications=is.true`, { headers }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers }),
      ]);
      if (!profilesRes.ok) {
        const detail = await profilesRes.text().catch(() => "");
        console.error(`[send_global_comm] destinataires illisibles (${profilesRes.status}) : ${detail.slice(0, 200)}`
          + " — vérifier que la migration 2026-08-15_communications_commerciales.sql est appliquée.");
        return res.status(503).json({ error: "Destinataires illisibles — migration non appliquée ?" });
      }
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
      journaliser("send_global_comm", { details: { envoyes: sent, extrait: String(message).slice(0, 200) } });
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
        } catch (e) { console.error("[bo-action] URL signée du document non générée :", e.message); }
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
      // `expires_at` : fin de validité, saisie pour les documents qui en ont
      // une (attestation RC Pro, URSSAF). Sans elle, rien ne suit l'expiration
      // et l'article 19.1 des CGPS — renouvellement annuel, suspension après
      // trente jours — reste une promesse sans effet.
      const expiresAt = req.body.expiresAt ? String(req.body.expiresAt).slice(0, 10) : null;
      if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
        return res.status(400).json({ error: "Date de validité invalide (attendu AAAA-MM-JJ)" });
      }

      const patchDocRes = await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${req.body.docId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation" },
        // `verified_at` date la vérification : c'est de lui que court le délai
        // de trente jours au terme duquel la pièce d'identité est supprimée
        // (CGPS art. 14.4).
        body: JSON.stringify({ verified: true, verified_at: new Date().toISOString(),
                               ...(expiresAt ? { expires_at: expiresAt } : {}) }),
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
      // `profiles.docs_verified` était écrit ici, et lu NULLE PART — ni dans
      // /api, ni dans src/, ni dans la documentation. Le commentaire d'origine
      // assumait que la colonne pouvait ne pas exister et ignorait l'échec.
      //
      // Une écriture que personne ne lit ne prouve rien et ne protège rien :
      // elle donne seulement l'impression qu'un état est suivi. L'information
      // existe déjà, exacte, dans `documents.verified` et `documents.verified_at`.
      // Qui a validé cette pièce, et quand : la question sera posée en contrôle.
      journaliser("verify_doc", { target_id: profileId, details: { doc_id: String(req.body.docId) } });
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
      await notifier({
          user_id: profileId,
          type:    "system",
          title:   `Document à renvoyer : ${label}`,
          body:    `Votre document « ${label} » n'a pas pu être validé. Motif : ${motif}. Merci de déposer un nouveau document depuis votre espace.`,
        }, SUPABASE_URL, headers).catch(e => console.error("[reject_doc] notification échouée :", e.message));

      journaliser("reject_doc", { target_id: profileId, reason: motif, details: { doc_id: String(req.body.docId), type: doc.type } });
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

    // ═══════════════════════════════════════════════════════════════════════
    // Versements : retenue (CGPS art. 7.4) et créances (CGPS art. 8B.3)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Ces deux articles décrivaient depuis leur rédaction des mécanismes que
    // rien n'exécutait. Une clause qu'on n'exerce jamais se lit mal en
    // contentieux — et surtout, sans écran, personne ne voit qu'un versement
    // est bloqué.

    // ── Export DAC7 (art. 1649 ter A et suivants du CGI) ──
    //
    // L'opérateur de plateforme déclare chaque année l'identité de ses
    // prestataires et les contreparties qui leur ont été versées. Rien ne le
    // permettait : ni collecte du NIF, ni décompte des opérations, ni export.
    //
    // Cet export ne DÉCLARE rien — il produit le fichier de travail à partir
    // duquel la déclaration se prépare, et surtout il rend visible ce qui
    // manque. Une déclaration incomplète se répare ; une déclaration qu'on
    // découvre incomplète le 31 janvier, non.
    if (action === "export_dac7") {
      const annee = Number(body.annee) || new Date().getFullYear();
      if (annee < 2020 || annee > 2100) return res.status(400).json({ error: "Année invalide" });
      const debut = `${annee}-01-01`;
      const fin   = `${annee + 1}-01-01`;

      const [pRes, mRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire`
          + `&select=id,prenom,nom,societe_nom,siret,nif,residence_fiscale,adresse,code_postal,ville,rib`, { headers }),
        // Seules les prestations RÉELLEMENT VERSÉES entrent dans la déclaration :
        // ce qui est en attente ou retenu n'a pas été perçu par le prestataire.
        fetch(`${SUPABASE_URL}/rest/v1/missions?payout_status=eq.transferred`
          + `&date=gte.${debut}&date=lt.${fin}`
          + `&select=id,prestataire_id,date,payout_amount,payout_compensation`, { headers }),
      ]);
      if (!pRes.ok || !mRes.ok) {
        console.error(`[export_dac7] lecture impossible (profils ${pRes.status}, prestations ${mRes.status}) `
          + "— vérifier que la migration 2026-08-16_conformite_dac7.sql est appliquée.");
        return res.status(503).json({ error: "Export indisponible — migration non appliquée ?" });
      }
      const profils = await pRes.json().catch(() => []);
      const missions = await mRes.json().catch(() => []);

      const parPresta = new Map();
      for (const m of (Array.isArray(missions) ? missions : [])) {
        if (!m.prestataire_id) continue;
        const cur = parPresta.get(m.prestataire_id) || { operations: 0, brut: 0, retenu: 0 };
        cur.operations += 1;
        cur.brut   += Number(m.payout_amount || 0);
        cur.retenu += Number(m.payout_compensation || 0);
        parPresta.set(m.prestataire_id, cur);
      }

      // Les adresses e-mail vivent dans auth, pas dans profiles.
      const emails = {};
      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers });
        const uData = await uRes.json();
        for (const u of (uData.users || [])) emails[u.id] = u.email || "";
      } catch (e) {
        console.error("[export_dac7] adresses e-mail illisibles :", e.message);
      }

      const lignes = (Array.isArray(profils) ? profils : [])
        .filter(p => parPresta.has(p.id))
        .map(p => {
          const t = parPresta.get(p.id);
          // Ce qui manque est nommé, pas laissé vide : c'est la colonne qu'on
          // trie pour savoir qui relancer.
          const manquant = [
            !p.nif && "NIF",
            !p.residence_fiscale && "résidence fiscale",
            !p.siret && "SIRET",
            !(p.adresse && p.code_postal && p.ville) && "adresse",
          ].filter(Boolean).join(" + ");
          return {
            prestataire_id: p.id,
            nom: [p.prenom, p.nom].filter(Boolean).join(" "),
            raison_sociale: p.societe_nom || "",
            email: emails[p.id] || "",
            adresse: [p.adresse, p.code_postal, p.ville].filter(Boolean).join(", "),
            siret: p.siret || "",
            nif: p.nif || "",
            residence_fiscale: p.residence_fiscale || "",
            iban: p.rib || "",
            nombre_operations: t.operations,
            montant_brut: Math.round(t.brut * 100) / 100,
            retenues: Math.round(t.retenu * 100) / 100,
            donnees_manquantes: manquant,
          };
        })
        .sort((a, b) => b.montant_brut - a.montant_brut);

      const incomplets = lignes.filter(l => l.donnees_manquantes).length;
      console.log(`[export_dac7] ${annee} : ${lignes.length} prestataire(s), ${incomplets} dossier(s) incomplet(s)`);
      return res.status(200).json({ annee, lignes, incomplets });
    }

    // ── Sortie du portefeuille : rembourser tous les soldes détenus ──
    //
    // Le portefeuille rechargeable est supprimé. « Supprimer » ne peut pas
    // vouloir dire effacer les soldes : ce serait garder l'argent des clients.
    // Il faut le leur rendre.
    //
    // Cette action liste les soldes restants. Le remboursement lui-même passe
    // par le chemin déjà éprouvé (`/api/wallet` action `rembourser_solde`), que
    // le client déclenche depuis son portefeuille — mais il faut d'abord savoir
    // qui est concerné, et le leur dire.
    if (action === "soldes_a_rembourser") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?prepaid_balance=gt.0&select=id,prenom,nom,prepaid_balance&order=prepaid_balance.desc`,
        { headers }
      );
      if (!r.ok) {
        console.error(`[soldes_a_rembourser] lecture impossible (${r.status})`);
        return res.status(503).json({ error: "Soldes illisibles" });
      }
      const rows = await r.json().catch(() => []);
      const total = (Array.isArray(rows) ? rows : []).reduce((t, p) => t + Number(p.prepaid_balance || 0), 0);

      // Prévenir chacun : un droit de remboursement dont personne n'a
      // connaissance n'est pas un droit exercé. On notifie une seule fois par
      // appel, à l'administrateur d'en décider le moment.
      if (body.notifier === true) {
        for (const p of (Array.isArray(rows) ? rows : [])) {
          await notifier({ user_id: p.id, type: "system",
              title: "Votre portefeuille va être remboursé",
              body: `Le portefeuille ALANE est fermé. Votre solde de ${Number(p.prepaid_balance).toFixed(2)} € `
                  + `vous est intégralement remboursé sur votre moyen de paiement d'origine : `
                  + `utilisez le bouton « Me rembourser » depuis votre portefeuille. `
                  + `Vous pouvez aussi l'utiliser pour régler une prestation d'ici là.`}, SUPABASE_URL, headers).catch(e => console.error(`[soldes_a_rembourser] notification échouée pour ${p.id} :`, e.message));
        }
        console.log(`[soldes_a_rembourser] ${rows.length} client(s) notifié(s), ${total.toFixed(2)} € au total`);
      }

      return res.status(200).json({ soldes: rows, total: Math.round(total * 100) / 100 });
    }

    if (action === "list_versements") {
      const vRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions`
        + `?payout_status=in.(pending,processing,held,failed,annule)`
        + `&select=id,prestataire_id,client_id,metier,sector,date,payout_status,payout_amount,`
        + `payout_due_at,payout_hold_reason,payout_hold_at,payout_hold_until,payout_compensation,status`
        + `&order=payout_due_at&limit=300`,
        { headers }
      );
      if (!vRes.ok) {
        const detail = await vRes.text().catch(() => "");
        console.error(`[list_versements] lecture impossible (${vRes.status}) : ${detail.slice(0, 200)}`);
        return res.status(503).json({ error: "Versements illisibles — vérifier que les migrations sont appliquées." });
      }
      const versements = await vRes.json().catch(() => []);

      // Créances en cours, tous prestataires confondus.
      const cRes = await fetch(
        `${SUPABASE_URL}/rest/v1/creances_prestataires`
        + `?statut=in.(active,contestee)&select=*&order=created_at.desc&limit=200`,
        { headers }
      ).catch(() => null);
      const creances = cRes?.ok ? await cRes.json().catch(() => []) : [];

      // Noms, en une seule passe : un aller-retour par ligne rendait l'écran
      // inutilisable dès la centaine de versements.
      const ids = [...new Set([
        ...(Array.isArray(versements) ? versements : []).map(v => v.prestataire_id),
        ...(Array.isArray(creances) ? creances : []).map(c => c.prestataire_id),
      ].filter(Boolean))];
      const noms = {};
      // Qui peut effectivement recevoir un virement, et qui ne le peut pas.
      const versable = {};
      const idsOrphelins = new Set();
      if (ids.length) {
        const nRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids.join(",")})&select=id,prenom,nom,stripe_account_id,stripe_account_status`,
          { headers }
        ).catch(() => null);
        const nRows = nRes?.ok ? await nRes.json().catch(() => []) : [];
        for (const p of (Array.isArray(nRows) ? nRows : [])) {
          noms[p.id] = [p.prenom, p.nom].filter(Boolean).join(" ") || null;
          // Sans compte Stripe Connect actif, AUCUN virement ne peut partir vers
          // ce prestataire. Le back-office affichait « en retard » et accusait le
          // traitement automatique, qui n'y était pour rien : il manquait un
          // destinataire, pas une horloge.
          versable[p.id] = Boolean(p.stripe_account_id) && p.stripe_account_status === "enabled";
        }
      }

      // Alerte : un versement échu depuis plus de six heures signale un
      // traitement qui ne tourne plus. Sans ce compteur, personne ne le voit.
      const seuil = Date.now() - 6 * 3600000;
      const tardifs = (Array.isArray(versements) ? versements : []).filter(v =>
        v.payout_status === "pending" && v.payout_due_at && new Date(v.payout_due_at).getTime() < seuil
      );
      // Un retard dû à un prestataire sans compte de paiement n'est PAS un
      // traitement en panne, et le dire ainsi envoyait chercher la panne au
      // mauvais endroit — pendant des heures, dans les journaux Vercel.
      const bloques  = tardifs.filter(v => versable[v.prestataire_id] === false).length;
      const enRetard = tardifs.length - bloques;

      // Prestations clôturées dont AUCUN versement n'a été programmé.
      //
      // Elles n'apparaissaient nulle part : le filtre ci-dessus porte sur
      // `payout_status`, et ces prestations-là l'ont à NULL. Le prestataire
      // attend donc un virement que rien n'émettra, et personne ne le voit.
      //
      // C'est ce qu'a produit l'absence de `payout_amount` et `payout_due_at`
      // en base, du 12 au 16/08/2026 : la mise en attente du versement échouait
      // et la prestation restait clôturée sans échéance.
      const orphRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions`
        + `?status=eq.completed&payout_status=is.null`
        + `&select=id,prestataire_id,metier,sector,date,montant_total,tarif_horaire,hours,actual_hours`
        + `,date_debut,date_fin,delay_status,arrival_delay_minutes,started_at,heure_debut`
        + `&order=date&limit=100`,
        { headers }
      ).catch(() => null);
      const sansVersement = orphRes?.ok ? await orphRes.json().catch(() => []) : [];
      for (const m of (Array.isArray(sansVersement) ? sansVersement : [])) {
        // Le montant est calculé par la source unique, jamais réinventé ici.
        m.montant_du = montantsDeCloture(m).partPrestataire;
        m.echeance   = new Date(echeanceVersementMs(m)).toISOString();
        if (m.prestataire_id && !noms[m.prestataire_id]) idsOrphelins.add(m.prestataire_id);
      }
      if (idsOrphelins.size) {
        const nRes2 = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=in.(${[...idsOrphelins].join(",")})&select=id,prenom,nom`,
          { headers }
        ).catch(() => null);
        for (const p of (nRes2?.ok ? await nRes2.json().catch(() => []) : [])) {
          noms[p.id] = [p.prenom, p.nom].filter(Boolean).join(" ") || null;
        }
      }

      return res.status(200).json({
        versements: Array.isArray(versements) ? versements : [],
        creances: Array.isArray(creances) ? creances : [],
        sansVersement: Array.isArray(sansVersement) ? sansVersement : [],
        noms, versable, enRetard, bloques,
      });
    }

    // Programmer le versement d'une prestation clôturée qui n'en a pas.
    //
    // Le montant vient de `montantsDeCloture`, l'échéance de
    // `echeanceVersementMs` : les deux mêmes fonctions que la clôture normale.
    // Le refaire ici en produirait une seconde version, qui divergerait — c'est
    // exactement le défaut que ce projet passe son temps à éliminer, et c'est
    // aussi pourquoi ces reprises ne se font pas par un UPDATE en base.
    if (action === "programmer_versement") {
      const { mission_id } = body;
      if (!mission_id || !isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`
        + `&select=id,status,payout_status,prestataire_id,montant_total,tarif_horaire,hours,actual_hours`
        + `,date,date_debut,date_fin,heure_debut,started_at,delay_status,arrival_delay_minutes&limit=1`,
        { headers }
      );
      const m = (await mRes.json().catch(() => []))[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (m.status !== "completed") {
        return res.status(400).json({ error: `Statut ${m.status} — seule une prestation clôturée peut être mise en versement.` });
      }
      if (m.payout_status) {
        return res.status(409).json({ error: `Un versement est déjà enregistré (${m.payout_status}).` });
      }
      if (!m.prestataire_id) return res.status(400).json({ error: "Aucun prestataire sur cette prestation." });

      const { partPrestataire } = montantsDeCloture(m);
      if (!(partPrestataire > 0)) {
        return res.status(400).json({ error: "Montant dû nul ou incalculable — à examiner à la main." });
      }
      const echeance = new Date(echeanceVersementMs(m)).toISOString();

      // Filtre sur `payout_status=is.null` : deux clics ne programment pas deux
      // versements.
      const up = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&payout_status=is.null`,
        { method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
          body: JSON.stringify({ payout_status: "pending", payout_amount: partPrestataire, payout_due_at: echeance }) }
      );
      const lignes = await up.json().catch(() => []);
      if (!up.ok || !Array.isArray(lignes) || lignes.length === 0) {
        console.error(`[programmer_versement] échec pour ${mission_id} (${up.status}) : ${JSON.stringify(lignes).slice(0, 200)}`);
        return res.status(500).json({ error: "Le versement n'a pas pu être programmé." });
      }

      if (m.prestataire_id) {
        await notifier({ user_id: m.prestataire_id, type: "system", title: "Versement programmé 💶",
            body: `Le versement de votre prestation du ${m.date || ""} a été programmé : ${partPrestataire.toFixed(2).replace(".", ",")} €. Il part à l'expiration du délai de réclamation.`}, SUPABASE_URL, headers).catch(e => console.error("[programmer_versement] notification non envoyée :", e.message));
      }

      journaliser("programmer_versement", { target_id: mission_id, details: { montant: partPrestataire, echeance } });
      return res.status(200).json({ success: true, montant: partPrestataire, echeance });
    }

    if (action === "retenir_versement") {
      const { mission_id, motif, duree_jours } = body;
      if (!mission_id || !isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      // Motifs limitativement énumérés par l'article 7.4. Une retenue pour un
      // motif non prévu au contrat serait une retenue sans fondement.
      const MOTIFS = {
        reclamation_client:  "une réclamation du client portant sur la prestation",
        opposition_bancaire: "une opposition bancaire ou une procédure de rétrofacturation",
        suspicion_fraude:    "des indices sérieux de fraude, de fausse déclaration ou de prestation non exécutée",
        creance_alane:       "une créance d'ALANE au titre de l'article 8B.3",
        demande_autorite:    "une demande d'une autorité judiciaire, administrative ou de l'établissement de paiement",
      };
      if (!MOTIFS[motif]) {
        return res.status(400).json({ error: `Motif invalide. Attendu : ${Object.keys(MOTIFS).join(", ")}` });
      }
      // Quatre-vingt-dix jours au maximum, comme l'écrit l'article.
      const jours = Math.min(90, Math.max(1, Number(duree_jours) || 90));
      const maintenant = new Date();
      const jusqua = new Date(maintenant.getTime() + jours * 86400000);

      const mRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,prestataire_id,payout_status,payout_amount,metier,sector,date`,
        { headers }
      );
      const mRows = await mRes.json().catch(() => []);
      const mission = Array.isArray(mRows) && mRows[0];
      if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
      if (!["pending", "failed"].includes(mission.payout_status)) {
        return res.status(400).json({
          error: mission.payout_status === "transferred"
            ? "Le versement est déjà parti — une retenue n'a plus d'objet."
            : `Versement en statut ${mission.payout_status || "inconnu"} — retenue impossible.`,
        });
      }

      // Verrou : on ne retient que ce qui est encore en attente à cet instant.
      const patch = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&payout_status=in.(pending,failed)`,
        { method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
          body: JSON.stringify({
            payout_status: "held", payout_hold_reason: motif,
            payout_hold_at: maintenant.toISOString(), payout_hold_until: jusqua.toISOString(),
          }) }
      );
      const patched = await patch.json().catch(() => []);
      if (!patch.ok || !Array.isArray(patched) || patched.length === 0) {
        console.error(`[retenir_versement] échec sur ${mission_id} (${patch.status})`);
        return res.status(409).json({ error: "Le versement a changé d'état — rechargez la page." });
      }

      // « Elle est notifiée au Prestataire par écrit, avec son motif et son
      // montant, au plus tard le jour où elle prend effet. » C'est une
      // condition de l'article, pas une politesse : la retenue et sa
      // notification partent ensemble.
      const libelle = esc(mission.metier || mission.sector || "Prestation");
      const montant = Number(mission.payout_amount || 0).toFixed(2);
      const finLe = jusqua.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
      if (mission.prestataire_id) {
        await notifier({ user_id: mission.prestataire_id, type: "system",
            title: "Versement suspendu",
            body: `Le versement de ${montant} € pour « ${libelle} » du ${mission.date || "?"} est suspendu au motif suivant : `
                + `${MOTIFS[motif]}. La retenue prend fin au plus tard le ${finLe}. `
                + `Vous pouvez la contester à direction@alane.fr : elle est examinée de façon contradictoire et levée si le motif n'est pas établi.`}, SUPABASE_URL, headers).catch(e => console.error("[retenir_versement] notification non créée :", e.message));

        try {
          const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.prestataire_id}`, { headers });
          const uData = await uRes.json();
          if (uData?.email) {
            await sendEmail({
              to: uData.email,
              subject: `Versement suspendu — prestation du ${mission.date || ""}`,
              html: emailHtml(
                `<p>Bonjour,</p>`
                + `<p>Le versement de <strong>${montant} €</strong> correspondant à votre prestation `
                + `« ${libelle} » du ${esc(String(mission.date || "?"))} est <strong>suspendu</strong>.</p>`
                + `<p><strong>Motif :</strong> ${MOTIFS[motif]}.</p>`
                + `<p>Conformément à l'article 7.4 des CGPS, cette retenue est limitée aux sommes en rapport avec `
                + `l'événement qui la motive et ne peut excéder quatre-vingt-dix jours. Elle prend fin au plus tard `
                + `le <strong>${finLe}</strong>, sauf procédure judiciaire ou opposition bancaire en cours.</p>`
                + `<p>Vous pouvez la contester en écrivant à <strong>direction@alane.fr</strong>. Votre demande sera `
                + `examinée de façon contradictoire, et la retenue levée si le motif n'est pas établi.</p>`
              ),
            });
          }
        } catch (e) {
          // La retenue est prise, mais l'intéressé ne l'a pas apprise par écrit.
          // C'est la condition posée par l'article : il faut que cela se voie.
          console.error(`[retenir_versement] e-mail de notification NON envoyé pour ${mission_id} :`, e.message);
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "retenir_versement", target_id: mission_id, reason: motif }) }).catch(() => {});
      return res.status(200).json({ success: true, payout_hold_until: jusqua.toISOString() });
    }

    if (action === "lever_retenue") {
      const { mission_id } = body;
      if (!mission_id || !isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      const patch = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&payout_status=eq.held`,
        { method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
          body: JSON.stringify({ payout_status: "pending", payout_hold_reason: null,
                                 payout_hold_at: null, payout_hold_until: null }) }
      );
      const rows = await patch.json().catch(() => []);
      if (!patch.ok || !Array.isArray(rows) || rows.length === 0) {
        return res.status(409).json({ error: "Aucune retenue en cours sur cette prestation." });
      }
      if (rows[0].prestataire_id) {
        await notifier({ user_id: rows[0].prestataire_id, type: "system",
            title: "Retenue levée ✅",
            body: "La retenue sur votre versement a été levée. Le virement est de nouveau programmé et partira au prochain traitement."}, SUPABASE_URL, headers).catch(() => {});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "lever_retenue", target_id: mission_id }) }).catch(() => {});
      return res.status(200).json({ success: true });
    }

    if (action === "creer_creance") {
      const { prestataire_id, montant, motif, mission_id } = body;
      if (!prestataire_id || !isUuidId(prestataire_id)) return res.status(400).json({ error: "prestataire_id invalide" });
      if (mission_id && !isUuidId(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      const m = Math.round(Number(montant) * 100) / 100;
      if (!Number.isFinite(m) || m <= 0) return res.status(400).json({ error: "Montant invalide" });
      if (!motif || String(motif).trim().length < 10) {
        // Le motif est repris tel quel dans la notification écrite au
        // prestataire : « remboursement » tout seul ne lui apprend rien.
        return res.status(400).json({ error: "Motif requis (10 caractères minimum) — il est communiqué au prestataire." });
      }

      const maintenant = new Date();
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/creances_prestataires`, {
        method: "POST", headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({
          prestataire_id, montant_initial: m, montant_restant: m,
          motif: String(motif).trim(), mission_id: mission_id || null, statut: "active",
          // Notifiée dans la foulée : l'article impose l'information préalable
          // avec le détail du calcul AVANT la première retenue. Une créance
          // créée sans notification ne serait jamais compensée — _creances.js
          // l'écarte — et resterait à dormir sans que personne ne le voie.
          notifiee_at: maintenant.toISOString(),
          exigible_at: dateExigibilite(maintenant.getTime()),
        }),
      });
      const rows = await ins.json().catch(() => []);
      if (!ins.ok || !Array.isArray(rows) || rows.length === 0) {
        const detail = await ins.text?.().catch(() => "") || JSON.stringify(rows);
        console.error(`[creer_creance] insertion refusée (${ins.status}) : ${String(detail).slice(0, 200)}`);
        return res.status(503).json({ error: "Créance non enregistrée — vérifier que la migration 2026-08-14_retenue_et_creances.sql est appliquée." });
      }
      const creance = rows[0];

      const exigibleLe = new Date(creance.exigible_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
      await notifier({ user_id: prestataire_id, type: "system",
          title: "Somme due à ALANE",
          body: `Une somme de ${m.toFixed(2)} € est due au titre de l'article 8B.3 des CGPS. Motif : ${String(motif).trim()}. `
              + `Elle sera récupérée sur vos versements à venir, dans la limite de la moitié de chacun d'eux. `
              + `Vous pouvez contester à direction@alane.fr sous quinze jours ; la contestation suspend la retenue.`}, SUPABASE_URL, headers).catch(() => {});

      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, { headers });
        const uData = await uRes.json();
        if (uData?.email) {
          await sendEmail({
            to: uData.email,
            subject: `Somme due — ${m.toFixed(2)} €`,
            html: emailHtml(
              `<p>Bonjour,</p>`
              + `<p>Une somme de <strong>${m.toFixed(2)} €</strong> est due à ALANE au titre de l'article 8B.3 des CGPS.</p>`
              + `<p><strong>Motif :</strong> ${esc(String(motif).trim())}</p>`
              + `<p><strong>Comment elle sera récupérée :</strong> par compensation sur vos rémunérations à venir, `
              + `<strong>dans la limite de la moitié de chaque versement</strong>, jusqu'à extinction. `
              + `Chaque retenue vous sera indiquée en face de la prestation concernée.</p>`
              + `<p>À défaut de rémunération à venir suffisante, la somme deviendra exigible le `
              + `<strong>${exigibleLe}</strong>.</p>`
              + `<p>Vous pouvez contester cette créance en écrivant à <strong>direction@alane.fr</strong> dans un délai `
              + `de quinze jours. La contestation suspend la compensation jusqu'à examen contradictoire.</p>`
            ),
          });
        }
      } catch (e) {
        console.error(`[creer_creance] e-mail de notification NON envoyé pour ${creance.id} :`, e.message);
      }

      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "creer_creance", target_id: prestataire_id, reason: `${m.toFixed(2)} € — ${String(motif).trim()}` }) }).catch(() => {});
      return res.status(200).json({ success: true, creance });
    }

    if (action === "statuer_creance") {
      // Contester suspend la compensation ; abandonner l'éteint sans la
      // recouvrer. Les deux se journalisent : ce sont des décisions d'argent.
      const { creance_id, decision } = body;
      if (!creance_id || !isUuidId(creance_id)) return res.status(400).json({ error: "creance_id invalide" });
      const STATUTS = { contestee: "contestee", active: "active", abandonnee: "abandonnee" };
      if (!STATUTS[decision]) return res.status(400).json({ error: "Décision invalide (contestee, active, abandonnee)" });

      const patch = await fetch(`${SUPABASE_URL}/rest/v1/creances_prestataires?id=eq.${creance_id}&statut=in.(active,contestee)`, {
        method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ statut: STATUTS[decision], contestee_at: decision === "contestee" ? new Date().toISOString() : null,
                               updated_at: new Date().toISOString() }),
      });
      const rows = await patch.json().catch(() => []);
      if (!patch.ok || !Array.isArray(rows) || rows.length === 0) {
        return res.status(409).json({ error: "Créance introuvable ou déjà éteinte." });
      }
      const c = rows[0];
      const messages = {
        contestee:  "Votre contestation est enregistrée : la retenue sur vos versements est suspendue le temps de l'examen.",
        active:     "Après examen, la somme due est maintenue. La retenue sur vos versements à venir reprend.",
        abandonnee: "La somme qui vous était réclamée est abandonnée. Plus aucune retenue ne sera appliquée.",
      };
      await notifier({ user_id: c.prestataire_id, type: "system",
          title: decision === "abandonnee" ? "Somme due abandonnée ✅" : "Somme due — mise à jour",
          body: messages[decision]}, SUPABASE_URL, headers).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "statuer_creance", target_id: creance_id, reason: decision }) }).catch(() => {});
      return res.status(200).json({ success: true });
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
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,hours,actual_hours,tarif_horaire,montant_total,date_debut,date_fin,delay_status,arrival_delay_minutes,started_at,metier,sector,recurrence,date,heure_debut,ville,extra_hours_tarif,extra_hours_appliquees`, { headers });
      const rows = await mr.json();
      const m = Array.isArray(rows) && rows[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (!["assigned","pending_acceptance"].includes(m.status)) return res.status(400).json({ error: `Statut ${m.status} — seules les prestations assigned/pending_acceptance peuvent être validées` });

      // Montants calculés par api/_cloture.js, comme les deux autres chemins de
      // clôture. Celui-ci en tenait une quatrième version : elle omettait le nombre
      // de jours et écrasait `montant_total` par la seule part horaire, effaçant les
      // frais de service encaissés — donc la trace de ce que le client avait payé.
      const { partPrestataire, totalClient } = montantsDeCloture(m);
      // PATCH atomique — garde le guard status=eq.assigned pour éviter double-crédit
      const patchStatus = m.status === "pending_acceptance" ? "pending_acceptance" : "assigned";
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=eq.${patchStatus}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation", "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed", montant_total: totalClient,
          validation_prestataire: true, validation_client: true,
          // Ce chemin ne programmait aucun virement : la prestation était clôturée,
          // le prestataire recevait « votre paiement est en cours », et rien n'était
          // jamais émis. Il suit désormais la même règle que les autres — versement
          // à la fermeture du délai de réclamation de 48 h (CGPS art. 17.1).
          ...(partPrestataire > 0 && m.prestataire_id ? {
            payout_status: "pending",
            payout_amount: partPrestataire,
            payout_due_at: new Date(echeanceVersementMs(m)).toISOString(),
          } : {}),
        }),
      });
      const patched = await patchRes.json().catch(() => []);
      if (!Array.isArray(patched) || patched.length === 0) return res.status(409).json({ error: "Prestation déjà validée ou statut changé" });
      // Cashback client
      let CASHBACK_TIERS = [{ min:0,max:2,rate:0.005 },{ min:3,max:5,rate:0.0075 },{ min:6,max:9,rate:0.01 },{ min:10,max:999,rate:0.015 }];
      try { const cbR = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=eq.cashback_rates&select=value`,{headers}); const cbD = await cbR.json(); if(Array.isArray(cbD)&&Array.isArray(cbD[0]?.value)) CASHBACK_TIERS=cbD[0].value; }
      catch (e) {
        // Repli sur les paliers par défaut : le cashback crédité ne serait pas
        // celui que le backoffice affiche, et personne ne le saurait.
        console.error("[cashback] paliers illisibles, valeurs par défaut appliquées :", e.message);
      }
      const profileR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.client_id}&select=cashback_balance,missions_completed_month`, { headers });
      const profileD = await profileR.json();
      const prof = Array.isArray(profileD) && profileD[0];
      const mCount = (prof?.missions_completed_month||0)+1;
      const rate = [...CASHBACK_TIERS].reverse().find(t=>mCount>=t.min)?.rate||0.01;
      const cashback = Math.round(partPrestataire*rate*100)/100;
      const cashbackRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, { method:"POST", headers:{...headers,"Prefer":"return=representation"}, body: JSON.stringify({ p_user_id:m.client_id, p_delta:cashback, p_missions:1 }) }).catch(()=>null);
      if (!cashbackRes?.ok) console.error(`[force_complete] cashback RPC failed for mission ${mission_id} — manual credit may be needed`);
      // Notification prestataire
      if (m.prestataire_id) {
        await notifier({ user_id:m.prestataire_id, type:"mission", title:"Prestation validée ✅", body:`Votre prestation "${m.metier||m.sector}" du ${m.date} a été validée. Votre paiement de ${partPrestataire.toFixed(2)} € est programmé à la fermeture du délai de 48 h dont le client dispose pour signaler un problème.`}, SUPABASE_URL, headers).catch(()=>{});
      }
      // Notification client
      await notifier({ user_id:m.client_id, type:"mission", title:"Prestation validée ✅", body:`Votre prestation "${m.metier||m.sector}" du ${m.date} a été validée.${cashback>0?` Cashback +${cashback.toFixed(2)} €`:""}`}, SUPABASE_URL, headers).catch(()=>{});
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
      return res.status(200).json({ success:true, montantTotal: totalClient, partPrestataire, cashback });
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
        await notifier({ user_id:m.client_id, type:"system", title:"Remboursement initié 💰", body: reason || "Un remboursement a été initié par ALANE. Vous serez crédité sous 5 à 10 jours ouvrés."}, SUPABASE_URL, headers).catch(()=>{});
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
      // Insertion groupée conservée — deux lignes, un seul aller-retour — mais
      // les téléphones sont prévenus : une prestation annulée par ALANE est
      // exactement ce qu'on ne découvre pas en ouvrant l'application par hasard.
      if (notifs.length) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify(notifs) }).catch(()=>{});
        await Promise.all(notifs.map(n =>
          sendPushToUser(n.user_id, { title: n.title, body: n.body, url: "/" }, SUPABASE_URL, headers).catch(() => {})
        ));
      }
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
      if (old_presta && old_presta !== newUser.id) await notifier({ user_id:old_presta, type:"system", title:"Prestation réassignée", body:reason||"Une prestation vous a été retirée et réassignée à un autre prestataire."}, SUPABASE_URL, headers).catch(()=>{});
      await notifier({ user_id:newUser.id, type:"mission", title:"Nouvelle prestation assignée ✅", body:reason||"Une prestation vous a été assignée directement par ALANE."}, SUPABASE_URL, headers).catch(()=>{});
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
      await notifier({ user_id:profileId, type:"cashback", title: Number(delta) >= 0 ? `Cashback crédité +${Math.abs(Number(delta)).toFixed(2)} €` : `Cashback ajusté ${Number(delta).toFixed(2)} €`, body: reason || "Ajustement par l'administration ALANE."}, SUPABASE_URL, headers).catch(()=>{});
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
      // Communication globale : la notification part aussi sur les téléphones.
      //
      // C'est un envoi de MASSE — une push à tous les comptes approuvés. Il est
      // fait par paquets, après l'écriture en base, et son volume est journalisé
      // : une annonce mal calibrée doit se retrouver dans les traces, pas se
      // découvrir dans les désabonnements.
      for (let i = 0; i < notifs.length; i += 100) {
        await Promise.all(notifs.slice(i, i + 100).map(n =>
          sendPushToUser(n.user_id, { title: n.title, body: n.body, url: "/" }, SUPABASE_URL, headers).catch(() => {})
        ));
      }
      console.log(`[broadcast] ${notifs.length} notifications et autant de push envoyées (cible : ${target || "tous"}).`);
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

    // ── Vigilance sur la dépendance économique (CGPS art. 10D) ────────
    //
    // Un conseil juridique a relevé que le risque résiduel ne tient plus à la
    // rédaction des CGPS mais aux comportements réels, et que le cas le plus
    // exposé est celui d'un auto-entrepreneur travaillant cinq jours par semaine
    // pendant des mois pour un seul client.
    //
    // L'article 10D réserve à ALANE le droit de demander des justificatifs dans
    // cette situation. Cette action la détecte : une clause de vigilance qu'on
    // n'exerce jamais ne vaut rien devant un contrôle.
    if (action === "signaux_dependance") {
      const seuilsDemandes = payload?.seuils && typeof payload.seuils === "object" ? payload.seuils : null;

      // Seuils réglables sans redéploiement. Un réglage absent n'est pas une
      // erreur : les valeurs par défaut du module s'appliquent.
      let seuils = { ...SEUILS_PAR_DEFAUT };
      try {
        const sr = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=eq.seuils_dependance&select=value`, { headers });
        const sd = await sr.json().catch(() => []);
        if (Array.isArray(sd) && sd[0]?.value) seuils = { ...seuils, ...sd[0].value };
      } catch (e) {
        console.error("[conformite] seuils_dependance illisible, valeurs par défaut :", e.message);
      }
      if (seuilsDemandes) seuils = { ...seuils, ...seuilsDemandes };

      // Seules les prestations réellement exécutées comptent : une réservation
      // annulée ne crée ni dépendance ni intégration.
      const depuis = new Date(Date.now() - (Number(seuils.fenetre_jours) || 180) * 86400000)
        .toISOString().slice(0, 10);
      const mr = await fetch(
        `${SUPABASE_URL}/rest/v1/missions`
        + `?status=in.(completed,closed)`
        + `&date=gte.${depuis}`
        + `&select=client_id,prestataire_id,date,hours,actual_hours,tarif_horaire`
        + `&limit=20000`,
        { headers }
      );
      const brutes = mr.ok ? await mr.json().catch(() => []) : [];
      if (!Array.isArray(brutes)) return res.status(200).json({ signaux: [], seuils });

      // Le montant retenu est la rémunération du prestataire, pas ce que le
      // client a payé : c'est son chiffre d'affaires qui mesure sa dépendance.
      const prestations = brutes.map(m => ({
        client_id: m.client_id,
        prestataire_id: m.prestataire_id,
        date: m.date,
        montant: Number(m.actual_hours ?? m.hours ?? 0) * Number(m.tarif_horaire || 0),
      }));

      const signaux = couplesADependance(prestations, seuils);
      if (!signaux.length) return res.status(200).json({ signaux: [], seuils, examines: prestations.length });

      // Noms des personnes concernées, pour que l'écran soit lisible.
      const ids = [...new Set(signaux.flatMap(s => [s.prestataire_id, s.client_id]))];
      const noms = {};
      try {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids.join(",")})&select=id,prenom,nom,societe_nom`, { headers });
        for (const p of (await pr.json().catch(() => []))) {
          noms[p.id] = p.societe_nom || [p.prenom, p.nom].filter(Boolean).join(" ") || p.id;
        }
      } catch (e) {
        console.error("[conformite] noms illisibles :", e.message);
      }

      return res.status(200).json({
        seuils,
        examines: prestations.length,
        signaux: signaux.map(s => ({
          ...s,
          prestataire: noms[s.prestataire_id] || s.prestataire_id,
          client: noms[s.client_id] || s.client_id,
        })),
      });
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

        // L'axe de la DURÉE, sur le lieu qui revient le plus.
        //
        // La récurrence dit qu'un endroit revient ; elle ne dit pas si c'est un
        // pic de trois semaines ou une présence de six mois. Or c'est la
        // continuité qui caractérise la mise à disposition durable : revenir
        // chaque mois, plusieurs jours par mois, finit par ressembler à une
        // place dans l'équipe du client.
        const auLieuTop = lieuTop
          ? horsVille.filter(m => norm([m.adresse, m.ville].filter(Boolean).join(" ")) === lieuTop)
          : [];
        const continuite = analyserContinuite(auLieuTop);

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
          // Durée : ces valeurs ne sont PAS des seuils légaux, elles déclenchent
          // un examen. Voir l'en-tête de `api/_dependance.js`.
          mois_consecutifs: continuite.moisConsecutifs,
          mois_distincts: continuite.moisDistincts,
          jours_max_par_mois: continuite.joursMaxParMois,
          premiere_intervention: continuite.premiere,
          derniere_intervention: continuite.derniere,
          presence_continue: continuite.continu,
          prestataires_distincts: prestatairesDistincts,
          duree_moyenne_h: Math.round(dureeMoyenne * 10) / 10,
          total_prestations: siennes.length,
        });
      }

      // Une présence continue passe devant : c'est le signal le plus lourd, et
      // celui qu'on veut voir en premier en ouvrant l'onglet.
      resultat.sort((a, b) =>
        (b.presence_continue ? 1 : 0) - (a.presence_continue ? 1 : 0)
        || b.mois_consecutifs - a.mois_consecutifs
        || b.occurrences_meme_lieu - a.occurrences_meme_lieu
      );
      return res.status(200).json(resultat);
    }

    // Révéler l'IBAN d'un compte, une fiche à la fois.
    //
    // Contrepartie du masquage dans `list` : la consultation reste possible, mais
    // devient un acte identifié et tracé, au lieu d'un envoi massif silencieux.
    // ── Éprouver la chaîne des notifications push ─────────────────────
    //
    // POURQUOI
    //
    // « Je ne reçois pas les notifications » n'avait aucune réponse : rien ne
    // permettait de distinguer un abonnement absent, une clé VAPID manquante,
    // un refus d'Apple ou un téléphone mal réglé. On corrigeait au hasard.
    //
    // Cette action envoie une notification à un compte donné et rend le
    // résultat de CHAQUE appareil : l'adresse du service, et ce qu'il a
    // répondu. Le diagnostic tient alors en un clic.
    if (action === "test_push") {
      if (!isUuidId(profileId)) return res.status(400).json({ error: "profileId invalide" });

      // `.replace(/\s/g, "")` et non `.trim()` : les variables Vercel de ce
      // projet contiennent des espaces INTERNES, invisibles, collés depuis un
      // iPad (CLAUDE.md §1.4). `trim` ne retire que les bords, et la clé
      // resterait inutilisable tout en paraissant présente.
      const cles = {
        publique: Boolean((process.env.VAPID_PUBLIC_KEY || "").replace(/\s/g, "")),
        privee:   Boolean((process.env.VAPID_PRIVATE_KEY || "").replace(/\s/g, "")),
      };

      const sr = await fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${profileId}&select=endpoint,p256dh,auth,created_at`,
        { headers }
      );
      const subs = sr.ok ? await sr.json().catch(() => []) : [];
      if (!Array.isArray(subs) || subs.length === 0) {
        return res.status(200).json({
          cles, appareils: [],
          diagnostic: "Aucun appareil abonné. L'utilisateur doit ouvrir l'application et accepter "
            + "les notifications. Sur iPhone, le site doit d'abord être ajouté à l'écran d'accueil : "
            + "Safari ne délivre aucune notification à un simple onglet.",
        });
      }
      if (!cles.publique || !cles.privee) {
        return res.status(200).json({
          cles, appareils: subs.map(s => ({ service: hoteDe(s.endpoint), depuis: s.created_at, statut: "non tenté" })),
          diagnostic: "Clés VAPID absentes de l'environnement Vercel : aucune notification ne peut partir, "
            + "quel que soit le nombre d'appareils abonnés.",
        });
      }

      const resultats = await Promise.all(subs.map(async (sub) => {
        const statut = await sendWebPush(sub, {
          title: "🔔 Test ALANE",
          body: "Si vous lisez ceci, les notifications fonctionnent.",
          url: "/",
        });
        return {
          service: hoteDe(sub.endpoint),
          depuis: sub.created_at,
          statut,
          lecture: statut === 201 || statut === 200 ? "accepté par le service de notification"
                 : statut === 410 ? "abonnement expiré — l'appareil a désinstallé ou révoqué"
                 : statut === false ? "envoi impossible (abonnement incomplet)"
                 : `refusé (${statut})`,
        };
      }));

      const accepte = resultats.some(r => r.statut === 201 || r.statut === 200);
      journaliser("test_push", { target_id: profileId, details: { appareils: resultats.length, accepte } });

      return res.status(200).json({
        cles, appareils: resultats,
        diagnostic: accepte
          ? "Envoyé et accepté. Si rien n'apparaît sur le téléphone, le réglage est côté appareil : "
            + "notifications autorisées pour ALANE, mode concentration, et — sur iPhone — site ajouté "
            + "à l'écran d'accueil et ouvert depuis cette icône."
          : "Aucun appareil n'a accepté. Voir le détail par appareil ci-dessous.",
      });
    }

    if (action === "reveal_iban") {
      if (!isUuidId(profileId)) return res.status(400).json({ error: "profileId invalide" });

      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}&select=rib&limit=1`, { headers });
      const pd = pr.ok ? await pr.json().catch(() => []) : [];
      let rib = Array.isArray(pd) && pd[0]?.rib;

      // Repli sur l'ancien emplacement tant que la migration
      // 2026-07-30_rgpd_iban_hors_du_jeton n'est pas passée partout.
      if (!rib) {
        try {
          const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
          if (ur.ok) rib = (await ur.json())?.user_metadata?.rib || null;
        } catch (e) {
          console.error("[reveal_iban] user_metadata illisible :", e.message);
        }
      }

      journaliser("reveal_iban", { target_id: profileId, details: { trouve: !!rib } });
      if (!rib) return res.status(404).json({ error: "Aucun IBAN enregistré pour ce compte" });
      return res.status(200).json({ rib: String(rib).replace(/\s/g, "").toUpperCase() });
    }

    if (action === "list_ratings") {
      // La colonne est `reviewee_provider_id`, jamais `reviewee_id`.
      //
      // Le select demandait `reviewee_id`, qui n'existe nulle part ailleurs dans
      // le projet. PostgREST refuse alors TOUTE la requête, pas seulement la
      // colonne fautive : l'onglet affichait « Aucun avis pour l'instant » quel
      // que soit le nombre d'avis déposés, et sans le moindre message.
      //
      // Le nom est trompeur — `reviewee_provider_id` porte le prestataire OU le
      // client selon le sens de l'avis — mais c'est celui de la base.
      const rr = await fetch(`${SUPABASE_URL}/rest/v1/ratings?select=id,rating,comment,created_at,reviewer_id,reviewee_provider_id,mission_id&order=created_at.desc&limit=200`, { headers });
      const ratings = await rr.json();
      if (!rr.ok) {
        console.error("[list_ratings] lecture refusée :", JSON.stringify(ratings).slice(0, 200));
        return res.status(500).json({ error: "Avis illisibles" });
      }
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,prenom,nom,role`, { headers });
      const profs = await pr.json();
      const nameMap = {}, roleMap = {};
      (Array.isArray(profs) ? profs : []).forEach(p => {
        nameMap[p.id] = `${p.prenom||""} ${p.nom||""}`.trim();
        roleMap[p.id] = p.role;
      });

      // Le SENS de l'avis se déduit du rôle du destinataire : un avis reçu par
      // un client vient forcément d'un prestataire, et réciproquement. C'est ce
      // qui permet de séparer les deux listes sans colonne supplémentaire.
      return res.status(200).json((Array.isArray(ratings) ? ratings : []).map(r => ({
        ...r,
        reviewee_id: r.reviewee_provider_id,
        reviewer_name: nameMap[r.reviewer_id] || "Inconnu",
        reviewee_name: nameMap[r.reviewee_provider_id] || "Inconnu",
        reviewee_role: roleMap[r.reviewee_provider_id] || null,
      })));
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
      journaliser("list_missions_export", { details: { lignes: Array.isArray(missions) ? missions.length : 0 } });
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
      journaliser("reset_visits", {});
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
      // Les frais de service, les taux de cashback et les seuils de vigilance
      // vivent dans platform_settings. Un changement non tracé est un changement
      // qu'on ne saura pas expliquer.
      journaliser("save_settings", { details: { key, value } });
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
      journaliser("seed_docs", { target_id: profileId, details: { inseres: inserts.length } });
      return res.status(200).json({ ok: true, inserted: inserts.length });
    }

    return res.status(400).json({ error: "Action invalide" });
  } catch (e) {
    console.error("bo-action error:", e);
    return res.status(500).json({ error: `Erreur serveur: ${e?.message || String(e)}` });
  }
}
