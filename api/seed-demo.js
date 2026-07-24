// Endpoint de seed — crée un faux prestataire complet pour démo
// Protégé par BO_PASSWORD. Appel : POST /api/seed-demo { "password": "..." }

const DEMO_EMAIL    = "thomas.dubois@demo-alane.fr";
const DEMO_PASSWORD = "Demo2024!";
const DEMO_PRENOM   = "Thomas";
const DEMO_NOM      = "Dubois";
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

const DOC_TYPES = ["kbis", "rib", "cni", "urssaf", "rc_pro", "diplomes"];

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

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BO_PASSWORD      = process.env.BO_PASSWORD;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Config manquante" });
  if (!BO_PASSWORD || (req.body?.password || "").trim() !== BO_PASSWORD.trim()) {
    return res.status(401).json({ error: "Mot de passe incorrect" });
  }

  const hdrs = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // ── 1. Créer ou retrouver l'utilisateur demo ─────────────────────────────
  let userId;

  // Chercher si l'utilisateur existe déjà
  const searchRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`,
    { headers: hdrs }
  );
  const searchData = searchRes.ok ? await searchRes.json() : null;
  const existing = searchData?.users?.find(u => u.email === DEMO_EMAIL);

  if (existing) {
    userId = existing.id;
    // Mettre à jour les métadonnées
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        email_confirm: true,
        user_metadata: buildMeta(),
      }),
    });
  } else {
    // Créer l'utilisateur
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

  // ── 2. Upsert profile ────────────────────────────────────────────────────
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

  // ── 3. Upload photo dans user_metadata ───────────────────────────────────
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: hdrs,
    body: JSON.stringify({
      user_metadata: { ...buildMeta(), photo_url: AVATAR_DATA_URL },
    }),
  });

  // ── 4. Uploader les fichiers placeholder dans Storage ────────────────────
  for (const docType of DOC_TYPES) {
    await uploadFile(
      SUPABASE_URL, SERVICE_ROLE_KEY,
      `${userId}/${docType}.pdf`,
      MINI_PDF_BYTES, "application/pdf"
    );
  }

  // ── 5. Upsert documents dans la table ────────────────────────────────────
  // Supprimer les anciens pour ce prestataire
  await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${userId}`, {
    method: "DELETE",
    headers: hdrs,
  });

  // Insérer les nouveaux
  const docs = DOC_TYPES.map(type => ({
    prestataire_id: userId,
    type,
    storage_path: `${userId}/${type}.pdf`,
    verified: true,
  }));

  await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
    method: "POST",
    headers: { ...hdrs, "Prefer": "return=minimal" },
    body: JSON.stringify(docs),
  });

  // ── 6. Créer quelques missions demo ──────────────────────────────────────
  // Trouver un client existant pour les missions (premier client approuvé)
  const clientsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?role=eq.client&status=eq.approved&limit=1&select=id`,
    { headers: hdrs }
  );
  const clients = clientsRes.ok ? await clientsRes.json() : [];
  const clientId = clients[0]?.id;

  if (clientId) {
    // Supprimer les missions demo précédentes
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
    societe_nom: "Thomas Dubois Services",
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
