// Endpoint de seed — crée un faux prestataire complet pour démo
// Auth : token BO session (header Authorization) OU mot de passe BO dans le body

import crypto from "crypto";

// Vérifie le token de session BO (même logique que bo-action.js)
function verifyBoToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const secret = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");
  if (!secret) return false;
  const parts = token.split(".");
  const ts      = parts[0];
  const sig     = parts.length >= 3 ? parts[2] : parts[1];
  const payload = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : parts[0];
  if (!ts || !sig) return false;
  const age = Math.floor(Date.now() / 1000) - parseInt(ts, 10);
  if (isNaN(age) || age < 0 || age > 86400) return false;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (sig.length !== expected.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex")); }
  catch { return false; }
}

const DEMO_EMAIL    = "alexandre.stngroupe@gmail.com";
const DEMO_PASSWORD = "Demo2024!";
const DEMO_PRENOM   = "Alexandre";
const DEMO_NOM      = "Atlan";
const DEMO_TEL      = "+33 6 12 34 56 78";
const DEMO_IBAN     = "FR7614508059809278244891L38";

// Avatar SVG encodé en base64 (visage stylisé couleurs ALANE)
const AVATAR_DATA_URL = "data:image/svg+xml;base64," + Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="100" fill="#0A1628"/>
  <circle cx="100" cy="78" r="38" fill="#7C6FE0"/>
  <ellipse cx="100" cy="175" rx="58" ry="44" fill="#7C6FE0"/>
  <circle cx="100" cy="78" r="28" fill="#C4A96B"/>
  <circle cx="88"  cy="74" r="4"  fill="#050E20"/>
  <circle cx="112" cy="74" r="4"  fill="#050E20"/>
  <path d="M88 90 Q100 100 112 90" stroke="#050E20" stroke-width="2.5" fill="none" stroke-linecap="round"/>
</svg>`).toString("base64");

// PDF minimal valide (passe la vérification %PDF)
const MINI_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n" +
  "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
  "0000000058 00000 n \n0000000115 00000 n \n" +
  "trailer<</Size 4/Root 1 0 R>>\nstartxref\n173\n%%EOF"
);

// Tous les documents obligatoires + diplomes (optionnel)
const DOC_TYPES = ["kbis", "rib", "cni", "urssaf", "domicile", "rc_pro", "diplomes"];

async function uploadFile(supabaseUrl, key, path, bytes, contentType) {
  const r = await fetch(`${supabaseUrl}/storage/v1/object/Documents/${path}`, {
    method: "POST",
    headers: {
      "apikey": key,
      "Authorization": `Bearer ${key}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: bytes,
  });
  return r.ok;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  const BO_PASSWORD      = process.env.BO_PASSWORD;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Config manquante" });

  const tokenOk = verifyBoToken(req.headers.authorization || "");
  const passwordOk = BO_PASSWORD && (req.body?.password || "").trim() === BO_PASSWORD.trim();
  if (!tokenOk && !passwordOk) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const hdrs = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // ── 1. Créer ou retrouver l'utilisateur demo ─────────────────────────────
  let userId;

  const searchRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
    { headers: hdrs }
  );
  const searchData = searchRes.ok ? await searchRes.json() : null;
  const allUsers = searchData?.users || [];
  const existing = allUsers.find(u => u.email?.toLowerCase() === DEMO_EMAIL.toLowerCase());

  if (existing) {
    userId = existing.id;
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        email_confirm: true,
        user_metadata: buildMeta(),
      }),
    });
  } else {
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: buildMeta(),
      }),
    });
    const created = createRes.ok ? await createRes.json() : null;
    if (!created?.id) {
      const txt = await createRes.text().catch(() => "");
      return res.status(500).json({ error: "Création utilisateur échouée", detail: txt });
    }
    userId = created.id;
  }

  // ── 2. Supprimer tous les autres prestataires ────────────────────────────
  const othersRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&id=neq.${userId}&select=id`,
    { headers: hdrs }
  );
  const others = othersRes.ok ? await othersRes.json() : [];
  const deletedIds = [];

  for (const p of others) {
    const pid = p.id;
    // Supprimer les documents de la table
    await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${pid}`, {
      method: "DELETE", headers: hdrs,
    });
    // Supprimer les missions (en tant que prestataire)
    await fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${pid}`, {
      method: "DELETE", headers: hdrs,
    });
    // Supprimer les candidatures
    await fetch(`${SUPABASE_URL}/rest/v1/candidatures?prestataire_id=eq.${pid}`, {
      method: "DELETE", headers: hdrs,
    });
    // Supprimer le profile
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${pid}`, {
      method: "DELETE", headers: hdrs,
    });
    // Supprimer l'auth user
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${pid}`, {
      method: "DELETE", headers: hdrs,
    });
    deletedIds.push(pid);
  }

  // ── 3. Upsert profile demo ────────────────────────────────────────────────
  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: { ...hdrs, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({
      id: userId,
      role: "prestataire",
      prenom: DEMO_PRENOM,
      nom: DEMO_NOM,
      status: "approved",
      missions_completed_month: 3,
      cashback_balance: 0,
      prepaid_balance: 0,
    }),
  });

  // ── 4. Upload photo dans user_metadata ───────────────────────────────────
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: hdrs,
    body: JSON.stringify({
      user_metadata: { ...buildMeta(), photo_url: AVATAR_DATA_URL },
    }),
  });

  // ── 5. Uploader les fichiers placeholder dans Storage ────────────────────
  for (const docType of DOC_TYPES) {
    await uploadFile(
      SUPABASE_URL, SERVICE_ROLE_KEY,
      `${userId}/${docType}.pdf`,
      MINI_PDF_BYTES, "application/pdf"
    );
  }

  // ── 6. Upsert documents dans la table ────────────────────────────────────
  await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${userId}`, {
    method: "DELETE",
    headers: hdrs,
  });

  const docs = DOC_TYPES.map(type => ({
    prestataire_id: userId,
    type,
    storage_path: `${userId}/${type}.pdf`,
    verified: true,
  }));

  await fetch(`${SUPABASE_URL}/rest/v1/documents?on_conflict=prestataire_id,type`, {
    method: "POST",
    headers: { ...hdrs, "Prefer": "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(docs),
  });

  // ── 7. Créer quelques missions demo ──────────────────────────────────────
  const clientsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?role=eq.client&status=eq.approved&limit=1&select=id`,
    { headers: hdrs }
  );
  const clients = clientsRes.ok ? await clientsRes.json() : [];
  const clientId = clients[0]?.id;

  if (clientId) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${userId}`,
      { method: "DELETE", headers: hdrs }
    );

    const missions = [
      {
        client_id: clientId, prestataire_id: userId,
        sector: "BTP", metier: "Électricien",
        date: "2026-08-05", hours: 8,
        ville: "Paris 11e", tarif_horaire: 35, montant_total: 280,
        status: "assigned",
      },
      {
        client_id: clientId, prestataire_id: userId,
        sector: "BTP", metier: "Électricien",
        date: "2026-07-20", hours: 6,
        ville: "Paris 8e", tarif_horaire: 35, montant_total: 210,
        status: "completed",
      },
      {
        client_id: clientId, prestataire_id: null,
        sector: "BTP", metier: "Plombier",
        date: "2026-08-10", hours: 4,
        ville: "Boulogne-Billancourt", tarif_horaire: 40, montant_total: 160,
        status: "open",
      },
    ];

    await fetch(`${SUPABASE_URL}/rest/v1/missions`, {
      method: "POST",
      headers: { ...hdrs, "Prefer": "return=minimal" },
      body: JSON.stringify(missions),
    });
  }

  return res.status(200).json({
    ok: true,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    userId,
    deletedPrestataires: deletedIds.length,
    message: `Profil demo créé — connectez-vous avec ${DEMO_EMAIL} / ${DEMO_PASSWORD}`,
  });
}

function buildMeta() {
  return {
    role: "prestataire",
    prenom: DEMO_PRENOM,
    nom: DEMO_NOM,
    telephone: DEMO_TEL,
    type_compte: "auto-entrepreneur",
    societe_nom: "Alexandre Atlan Services",
    statut_pro: "auto-entrepreneur",
    plan_abonnement: "essentiel",
    niveau: "Confirmé",
    experience_ans: 7,
    dispo_immediat: true,
    is_online: true,
    metiers: [
      { sector: "BTP", metier: "Électricien", niveau: "Expert", tarifNet: 35, certifs: "Habilitation électrique B2V" },
      { sector: "BTP", metier: "Plombier",    niveau: "Confirmé", tarifNet: 32, certifs: "" },
    ],
    competences: ["Installation électrique", "Tableau électrique", "Dépannage", "Plomberie sanitaire"],
    langues: ["Français", "Anglais"],
    dispos: {
      lundi:    ["matin", "après-midi"],
      mardi:    ["matin", "après-midi"],
      mercredi: ["matin"],
      jeudi:    ["matin", "après-midi"],
      vendredi: ["matin", "après-midi"],
    },
    rib: DEMO_IBAN,
  };
}
