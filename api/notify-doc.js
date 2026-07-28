import { verifyUser } from "./_auth.js";

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const SUPABASE_URL      = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  const RESEND_API_KEY    = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
  const RESEND_FROM       = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
  const ADMIN_EMAIL       = process.env.ADMIN_EMAIL;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).end();
  if (!RESEND_API_KEY || !ADMIN_EMAIL) return res.status(200).json({ ok: true }); // pas configuré — ignorer silencieusement

  const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!caller) return res.status(401).json({ error: "Non authentifié" });

  const { docType, isRenewal } = req.body || {};
  if (!docType || typeof docType !== "string") return res.status(400).json({ error: "docType requis" });

  const hdrs = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` };

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
  } catch {}

  const fullName   = [prenom, nom].filter(Boolean).join(" ") || email;
  const esc        = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const docLabel   = DOC_LABELS[docType] || esc(docType);
  const actionWord = isRenewal ? "renouvelé" : "chargé";
  const boUrl      = ((process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr") + "/bo";

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
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
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[notify-doc] Resend error:", e.message);
    return res.status(500).json({ error: "Erreur envoi email" });
  }
}
