import { resendBody } from "./_email.js";
import { verifyUser } from "./_auth.js";
import { appUrl } from "./_url.js";
import { docsRequisPour, piecesManquantes } from "./_documents.js";
import { mandatsManquants } from "./_mandats.js";
import { manquesCv } from "./_cv.js";


const DOC_LABELS = {
  kbis:     "KBIS / Extrait Kbis",
  rib:      "RIB / IBAN",
  cni:      "Pièce d'identité",
  photo:    "Photo de profil",
  urssaf:   "Attestation URSSAF",
  domicile: "Justificatif de domicile",
  rc_pro:   "RC Professionnelle",
  rcpro:    "RC Professionnelle",
  tva:      "Attestation TVA",
  diplomes: "Diplômes",
  autre:    "Autre document",
  titre_sejour: "Titre de séjour",
};

// Types acceptés — ceux de la contrainte CHECK de `documents.type`. Un type hors
// de cette liste serait refusé par la base : on le refuse ici, avec un message.
const TYPES_ENREGISTRABLES = ["photo", "kbis", "urssaf", "cni", "domicile", "rib", "rc_pro", "diplomes", "tva", "autre", "titre_sejour"];

// ── Enregistrer le document en base ─────────────────────────────────────────
//
// Le navigateur l'écrivait lui-même par un `upsert` (« insérer, ou mettre à jour
// si la pièce existe déjà »). Or un upsert réclame le droit de MODIFIER toutes
// les colonnes envoyées, `prestataire_id` compris — droit retiré au navigateur le
// 17/08/2026 (migration `colonnes_non_modifiables`), à juste titre : c'est ce qui
// l'empêchait de se déclarer lui-même « vérifié ». Chaque dépôt était donc
// refusé par la base (« permission denied for table documents ») : le fichier
// arrivait dans le bucket, la ligne jamais, et le back-office ne voyait rien.
// Constaté en recette le 25/09/2026 (scénario e2e/14).
//
// Le serveur l'écrit désormais, après avoir vérifié que le fichier est bien
// dans le dossier de l'appelant. Et un dépôt REMET la pièce en attente : un
// document remplacé n'a été vu par personne, il ne peut pas hériter de la
// validation — ni de la date de validité — du précédent.
async function enregistrerDocument(callerId, docType, SUPABASE_URL, hdrs) {
  const chemin = `${callerId}/${docType}`;
  const lr = await fetch(`${SUPABASE_URL}/storage/v1/object/list/Documents`, {
    method: "POST",
    headers: { ...hdrs, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: callerId, search: docType, limit: 100 }),
  });
  const objets = await lr.json().catch(() => null);
  if (!lr.ok || !Array.isArray(objets)) {
    console.error(`[notify-doc] bucket illisible pour ${chemin} : ${lr.status}`);
    return { ok: false, code: 502, error: "Le document n'a pas pu être vérifié. Réessayez." };
  }
  if (!objets.some(o => o.name === docType)) {
    return { ok: false, code: 404, error: "Fichier introuvable : l'envoi n'a pas abouti. Réessayez." };
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/documents?on_conflict=prestataire_id,type`, {
    method: "POST",
    headers: { ...hdrs, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      prestataire_id: callerId, type: docType, storage_path: chemin,
      verified: false, verified_at: null, expires_at: null, relance_expiration_at: null,
      created_at: new Date().toISOString(),
    }),
  });
  const lignes = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(lignes) || lignes.length === 0) {
    console.error(`[notify-doc] document ${chemin} NON enregistré : ${r.status} ${JSON.stringify(lignes || {}).slice(0, 300)}`);
    return { ok: false, code: 500, error: "Le document est arrivé mais n'a pas pu être enregistré. Réessayez." };
  }
  return { ok: true };
}

// ── Alerte « dossier complet » ───────────────────────────────────────────────
// Partagée par le dépôt d'une pièce et par l'enregistrement de la photo de
// profil (qui ne passe pas par le bucket : voir `verifierDossier` plus bas).
// Un échec d'envoi est journalisé, jamais remonté : ce n'est qu'un signal.
async function alerterDossierComplet({ caller, profil, fullName, email, esc, RESEND_API_KEY, RESEND_FROM, ADMIN_EMAIL }) {
  const restes = [
    ...mandatsManquants(profil),
    ...manquesCv(profil.cv || caller.user_metadata?.cv).map(m => `CV : ${m}`),
  ];
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: resendBody({
        from: RESEND_FROM,
        to: ADMIN_EMAIL,
        subject: `✅ Dossier complet — ${fullName} : à vérifier et activer`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
          <h2 style="color:#050E20;margin-bottom:4px">✅ Toutes les pièces obligatoires sont déposées</h2>
          <p style="color:#444">${esc(fullName)} (${esc(email)}) a déposé la dernière pièce obligatoire de son dossier.</p>
          <p style="color:#444">Vérifiez chaque pièce dans le back-office, puis ouvrez-lui l'accès aux prestations (« ✅ Activer l'accès aux prestations »).</p>
          ${restes.length
            ? `<p style="color:#b45309;font-weight:700;margin-top:16px">L'activation sera encore refusée tant que manque :</p><ul style="color:#444">${restes.map(x => `<li>${esc(x)}</li>`).join("")}</ul><p style="color:#666;font-size:13px">Le prestataire le complète depuis son espace ; il y est invité.</p>`
            : `<p style="color:#047857;font-weight:700;margin-top:16px">CV et mandats sont en ordre : rien d'autre ne bloque l'activation.</p>`}
          <a href="${appUrl()}/bo" style="display:inline-block;margin-top:12px;padding:12px 24px;background:#7C6FE0;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Ouvrir le back-office →</a>
        </div>`,
      }),
    });
    if (!r.ok) console.error(`[notify-doc] alerte « dossier complet » refusée pour ${caller.id} (${r.status}).`);
  } catch (e) {
    console.error(`[notify-doc] alerte « dossier complet » non envoyée pour ${caller.id} :`, e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const SUPABASE_URL      = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  const RESEND_API_KEY    = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
  const RESEND_FROM       = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
  const ADMIN_EMAIL       = process.env.ADMIN_EMAIL;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration serveur manquante" });

  const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!caller) return res.status(401).json({ error: "Session expirée — reconnectez-vous." });

  const hdrs = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` };
  const esc  = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  // ── La photo de profil, dernière pièce du dossier (30/09/2026) ──────────────
  //
  // Déposée depuis « Modifier mon profil », la photo va dans `profiles.avatar_url`
  // sans passer par ici : si c'était la dernière pièce manquante, personne
  // n'était prévenu que le dossier était complet. L'écran appelle donc ce mode
  // quand il enregistre une PREMIÈRE photo. Le serveur ne croit pas l'écran sur
  // parole : il n'alerte que si la photo était bien la seule pièce manquante —
  // aucune ligne « photo » dans `documents`, toutes les autres pièces déposées.
  if (req.body?.verifierDossier === true) {
    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
      console.error("[notify-doc] RESEND_API_KEY ou ADMIN_EMAIL absente — pas d'alerte « dossier complet » (photo).");
      return res.status(200).json({ ok: true, alerte: false });
    }
    try {
      const [pr, dr] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=role,prenom,nom,status,missions_enabled,avatar_url,cv,mandat_facturation_at,mandat_encaissement_at`, { headers: hdrs }),
        fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${caller.id}&select=type`, { headers: hdrs }),
      ]);
      const pl = await pr.json().catch(() => null);
      const dl = await dr.json().catch(() => null);
      if (!pr.ok || !dr.ok || !Array.isArray(pl) || !Array.isArray(dl)) {
        console.error(`[notify-doc] dossier illisible pour ${caller.id} (${pr.status}/${dr.status}) — pas d'alerte « dossier complet » (photo).`);
        return res.status(200).json({ ok: true, alerte: false });
      }
      const profil = pl[0];
      if (!profil || profil.role !== "prestataire" || profil.status !== "approved" || profil.missions_enabled === true || !profil.avatar_url) {
        return res.status(200).json({ ok: true, alerte: false });
      }
      const requis = docsRequisPour(caller.user_metadata?.nationalite, caller.user_metadata?.metiers_list).filter(d => d.required);
      const types  = dl.map(l => l.type);
      const sansPhoto = piecesManquantes(requis, types, false);
      const avecPhoto = piecesManquantes(requis, types, true);
      if (!(sansPhoto.length === 1 && sansPhoto[0].id === "photo" && avecPhoto.length === 0)) {
        return res.status(200).json({ ok: true, alerte: false });
      }
      const email = caller.email || "";
      const fullName = [profil.prenom, profil.nom].filter(Boolean).join(" ") || email;
      await alerterDossierComplet({ caller, profil, fullName, email, esc, RESEND_API_KEY, RESEND_FROM, ADMIN_EMAIL });
      return res.status(200).json({ ok: true, alerte: true });
    } catch (e) {
      console.error(`[notify-doc] vérification du dossier (photo) interrompue pour ${caller.id} :`, e.message);
      return res.status(200).json({ ok: true, alerte: false });
    }
  }

  const { docType, isRenewal } = req.body || {};
  if (!docType || typeof docType !== "string") return res.status(400).json({ error: "docType requis" });
  if (!TYPES_ENREGISTRABLES.includes(docType)) {
    console.error(`[notify-doc] type de document non enregistrable : ${docType} (compte ${caller.id})`);
    return res.status(400).json({ error: "Ce type de document ne peut pas encore être enregistré. Contactez le support." });
  }

  // Ce qui manquait AVANT ce dépôt : sert à savoir si c'est lui qui complète le
  // dossier (alerte « dossier complet », plus bas). Une lecture ratée ne bloque
  // pas le dépôt ; elle prive seulement de l'alerte, et c'est journalisé.
  let avantDepot = null;
  try {
    const dr = await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${caller.id}&select=type`, { headers: hdrs });
    const lignes = await dr.json().catch(() => null);
    if (dr.ok && Array.isArray(lignes)) avantDepot = lignes.map(l => l.type);
    else console.error(`[notify-doc] pièces déjà déposées illisibles (${dr.status}) — pas d'alerte « dossier complet » pour ce dépôt.`);
  } catch (e) {
    console.error("[notify-doc] pièces déjà déposées illisibles :", e.message);
  }

  let enr;
  try {
    enr = await enregistrerDocument(caller.id, docType, SUPABASE_URL, hdrs);
  } catch (e) {
    console.error(`[notify-doc] enregistrement de ${caller.id}/${docType} interrompu :`, e.message);
    enr = { ok: false, code: 502, error: "Le document n'a pas pu être enregistré. Réessayez." };
  }
  if (!enr.ok) return res.status(enr.code).json({ error: enr.error });

  // Le document est enregistré : c'est tout ce qui compte pour le prestataire.
  // L'e-mail à l'administration n'est qu'un signal ; son absence est journalisée.
  if (!RESEND_API_KEY || !ADMIN_EMAIL) {
    console.error("[notify-doc] RESEND_API_KEY ou ADMIN_EMAIL absente — administration NON prévenue par e-mail.");
    return res.status(200).json({ ok: true, enregistre: true });
  }

  // Récupérer le nom du prestataire
  let prenom = "", nom = "", email = caller.email || "";
  let profil = null;
  try {
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=prenom,nom,status,missions_enabled,avatar_url,cv,mandat_facturation_at,mandat_encaissement_at`, { headers: hdrs });
    const pData = pRes.ok ? await pRes.json().catch(() => []) : [];
    if (Array.isArray(pData) && pData[0]) { profil = pData[0]; prenom = pData[0].prenom || ""; nom = pData[0].nom || ""; }
    if (!prenom && !nom) {
      prenom = caller.user_metadata?.prenom || "";
      nom    = caller.user_metadata?.nom    || "";
    }
  } catch (e) { console.error("[notify-doc] nom du prestataire illisible :", e.message); }

  const fullName   = [prenom, nom].filter(Boolean).join(" ") || email;

  // ── Dossier complet : UNE alerte, au dépôt de la dernière pièce (29/09/2026) ──
  //
  // Alexandre recevait un courriel par pièce — sept ou huit par prestataire —
  // mais aucun ne disait « ce dossier est complet, il peut être vérifié et
  // activé ». Celui-ci part quand CE dépôt fait passer les pièces obligatoires
  // de « il en manque » à « toutes déposées » : une fois par dossier, sans
  // colonne à tenir. Il dit aussi ce qui bloquera encore l'activation.
  if (avantDepot && profil && profil.status === "approved" && profil.missions_enabled !== true) {
    const requis = docsRequisPour(caller.user_metadata?.nationalite, caller.user_metadata?.metiers_list).filter(d => d.required);
    const manquaient = piecesManquantes(requis, avantDepot, !!profil.avatar_url);
    // Relu APRÈS l'enregistrement, et non déduit de la lecture d'avant : deux
    // dépôts simultanés des deux dernières pièces voyaient chacun l'autre
    // manquer, et personne n'était prévenu (relecture du 30/09/2026). Relu,
    // au moins l'un des deux voit le dossier complet — au pire, deux alertes.
    let apres = [...avantDepot, docType];
    try {
      const ar = await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${caller.id}&select=type`, { headers: hdrs });
      const al = await ar.json().catch(() => null);
      if (ar.ok && Array.isArray(al)) apres = al.map(l => l.type);
      else console.error(`[notify-doc] pièces relues illisibles (${ar.status}) — repli sur la lecture d'avant.`);
    } catch (e) {
      console.error("[notify-doc] pièces relues illisibles :", e.message);
    }
    const manquent   = piecesManquantes(requis, apres, !!profil.avatar_url);
    if (manquaient.length > 0 && manquent.length === 0) {
      await alerterDossierComplet({ caller, profil, fullName, email, esc, RESEND_API_KEY, RESEND_FROM, ADMIN_EMAIL });
    }
  }
  const docLabel   = DOC_LABELS[docType] || esc(docType);
  const actionWord = isRenewal ? "renouvelé" : "chargé";
  const boUrl      = (appUrl()) + "/bo";

  // Un courriel par pièce, c'était sept ou huit par prestataire en cours
  // d'inscription (décision d'Alexandre, 29/09/2026 : trop de courriels). Pendant
  // la constitution du dossier, seule l'alerte « dossier complet » ci-dessus part.
  //
  // On garde le courriel pour un prestataire DÉJÀ activé qui remplace une pièce
  // (RC Pro renouvelée, titre ajouté…) : la pièce repasse « en attente », et
  // personne ne saurait sinon qu'il faut la revérifier. Profil illisible : on
  // prévient, plutôt que de laisser une pièce en attente sans que personne le sache.
  if (profil && profil.missions_enabled !== true) {
    return res.status(200).json({ ok: true, enregistre: true });
  }

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: resendBody({
        from: RESEND_FROM,
        to: ADMIN_EMAIL,
        subject: `[Document] ${fullName} a ${actionWord} : ${docLabel}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
          <h2 style="color:#050E20;margin-bottom:4px">📄 Nouveau document soumis</h2>
          <p style="color:#444;margin-bottom:20px">Un prestataire vient de ${actionWord} un document — une validation manuelle est peut-être requise.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
            <tr><td style="padding:7px 0;color:#666;width:140px">Prestataire</td><td style="font-weight:700">${esc(fullName)}</td></tr>
            <tr><td style="padding:7px 0;color:#666">Email</td><td>${esc(email)}</td></tr>
            <tr><td style="padding:7px 0;color:#666">Document</td><td style="font-weight:700">${docLabel}</td></tr>
            <tr><td style="padding:7px 0;color:#666">Action</td><td>${isRenewal ? "🔄 Renouvellement" : "⬆️ Premier chargement"}</td></tr>
          </table>
          <a href="${boUrl}" style="display:inline-block;padding:12px 24px;background:#7C6FE0;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Vérifier dans le backoffice →</a>
          <p style="margin-top:20px;font-size:12px;color:#888">ALANE Admin · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
        </div>`,
      }),
    });
    return res.status(200).json({ ok: true, enregistre: true });
  } catch (e) {
    // Le document EST enregistré : on ne le fait pas croire perdu au prestataire.
    console.error("[notify-doc] e-mail à l'administration non envoyé :", e.message);
    return res.status(200).json({ ok: true, enregistre: true });
  }
}
