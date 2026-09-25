import { resendBody } from "./_email.js";
import { verifyUser } from "./_auth.js";
import { appUrl } from "./_url.js";

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
};

// Types acceptés — ceux de la contrainte CHECK de `documents.type`. Un type hors
// de cette liste serait refusé par la base : on le refuse ici, avec un message.
const TYPES_ENREGISTRABLES = ["photo", "kbis", "urssaf", "cni", "domicile", "rib", "rc_pro", "diplomes", "tva", "autre"];

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

  const { docType, isRenewal } = req.body || {};
  if (!docType || typeof docType !== "string") return res.status(400).json({ error: "docType requis" });
  if (!TYPES_ENREGISTRABLES.includes(docType)) {
    console.error(`[notify-doc] type de document non enregistrable : ${docType} (compte ${caller.id})`);
    return res.status(400).json({ error: "Ce type de document ne peut pas encore être enregistré. Contactez le support." });
  }

  const hdrs = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` };

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
  try {
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=prenom,nom`, { headers: hdrs });
    const pData = pRes.ok ? await pRes.json().catch(() => []) : [];
    if (Array.isArray(pData) && pData[0]) { prenom = pData[0].prenom || ""; nom = pData[0].nom || ""; }
    if (!prenom && !nom) {
      prenom = caller.user_metadata?.prenom || "";
      nom    = caller.user_metadata?.nom    || "";
    }
  } catch (e) { console.error("[notify-doc] nom du prestataire illisible :", e.message); }

  const fullName   = [prenom, nom].filter(Boolean).join(" ") || email;
  const esc        = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const docLabel   = DOC_LABELS[docType] || esc(docType);
  const actionWord = isRenewal ? "renouvelé" : "chargé";
  const boUrl      = (appUrl()) + "/bo";

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
