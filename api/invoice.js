// /api/invoice.js — Serverless function that returns a printable HTML invoice
// Auth: token passed as query param (Bearer token from Supabase session)

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function verifyUser(token, supabaseUrl, serviceRoleKey) {
  if (!token) return null;
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export default async function handler(req, res) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).send("<h1>Configuration serveur manquante</h1>");
  }

  const { mission_id, token } = req.query;

  if (!mission_id || typeof mission_id !== "string" || !/^[0-9a-f-]{36}$/i.test(mission_id)) {
    return res.status(400).send("<h1>mission_id invalide</h1>");
  }

  // Verify auth
  const user = await verifyUser(token, supabaseUrl, serviceRoleKey);
  if (!user) {
    return res.status(401).send("<h1>Non autorisé</h1>");
  }

  // Fetch mission from Supabase
  const missionRes = await fetch(
    `${supabaseUrl}/rest/v1/missions?id=eq.${encodeURIComponent(mission_id)}&select=*`,
    {
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Accept": "application/json",
      },
    }
  );
  if (!missionRes.ok) {
    return res.status(500).send("<h1>Erreur lors de la récupération de la mission</h1>");
  }
  const missions = await missionRes.json();
  const mission = missions[0];

  if (!mission) {
    return res.status(404).send("<h1>Mission introuvable</h1>");
  }

  // Verify user is client or prestataire of this mission
  if (mission.client_id !== user.id && mission.prestataire_id !== user.id) {
    return res.status(403).send("<h1>Accès interdit</h1>");
  }

  // Fetch client profile + auth email
  let clientName = "";
  let clientEmail = "";
  let clientCompany = "";
  let clientSiret = "";

  if (mission.client_id) {
    const [profileRes, authRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(mission.client_id)}&select=prenom,nom,societe_nom,siret`, {
        headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}`, "Accept": "application/json" },
      }),
      fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(mission.client_id)}`, {
        headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}` },
      }),
    ]);
    if (profileRes.ok) {
      const profiles = await profileRes.json();
      const p = profiles[0];
      if (p) {
        clientName = [p.prenom, p.nom].filter(Boolean).join(" ");
        clientCompany = p.societe_nom || "";
        clientSiret = p.siret || "";
      }
    }
    if (authRes.ok) {
      const authUser = await authRes.json();
      clientEmail = authUser.email || "";
      if (!clientName) {
        const meta = authUser.user_metadata || {};
        clientName = [meta.prenom, meta.nom].filter(Boolean).join(" ") || authUser.email || "";
      }
    }
  }

  // Fetch prestataire profile
  let prestaName = "";
  let prestaCompany = "";
  let prestaSiret = "";

  if (mission.prestataire_id) {
    const prestaRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(mission.prestataire_id)}&select=prenom,nom,societe_nom,siret`,
      {
        headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}`, "Accept": "application/json" },
      }
    );
    if (prestaRes.ok) {
      const profiles = await prestaRes.json();
      const p = profiles[0];
      if (p) {
        prestaName = [p.prenom, p.nom].filter(Boolean).join(" ") || "Prestataire";
        prestaCompany = p.societe_nom || "";
        prestaSiret = p.siret || "";
      }
    }
  }

  // Compute invoice data
  const invoiceNum = `FAC-${mission_id.slice(0, 8).toUpperCase()}`;
  const today = new Date();
  const issueDate = today.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const hours = Number(mission.hours || 0);
  const tarifHoraire = Number(mission.tarif_horaire || 0);
  const htCalc = Math.round(hours * tarifHoraire * 100) / 100;
  const ht = htCalc > 0 ? htCalc : Number(mission.montant_total || 0);
  const htFormatted = ht.toFixed(2).replace(".", ",");

  const missionDate = mission.date || "";
  const heureDebut = mission.heure_debut || "";
  const metier = mission.metier || "Prestation de service";
  const secteur = mission.sector || "";
  const ville = mission.ville || "";
  const adresse = mission.adresse || "";

  const lineItem = htCalc > 0
    ? `${metier} — ${hours}h × ${tarifHoraire.toFixed(2).replace(".", ",")} €/h`
    : metier;

  // Build HTML
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Facture ${escHtml(invoiceNum)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background: #0A1628;
      color: #E8EAF0;
      min-height: 100vh;
      padding: 32px 16px 80px;
    }
    .page {
      max-width: 700px;
      margin: 0 auto;
    }
    .header {
      background: linear-gradient(135deg, #0A1628, #162547);
      border-radius: 16px 16px 0 0;
      padding: 28px 28px 20px;
      border-bottom: 2px solid #1E3A5F;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .logo {
      font-size: 28px;
      font-weight: 900;
      color: #7C6FE0;
      letter-spacing: 2px;
    }
    .logo-sub {
      color: #8899AA;
      font-size: 11px;
      margin-top: 4px;
    }
    .invoice-meta { text-align: right; }
    .invoice-label {
      font-size: 13px;
      font-weight: 800;
      color: #E8EAF0;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .invoice-num {
      font-size: 18px;
      font-weight: 900;
      color: #7C6FE0;
      margin-top: 4px;
    }
    .invoice-date {
      color: #8899AA;
      font-size: 12px;
      margin-top: 4px;
    }
    .card {
      background: #0D1B3E;
      border: 1px solid #1E3A5F;
      border-top: none;
      padding: 24px 28px;
    }
    .card:last-of-type { border-radius: 0 0 16px 16px; }
    .parties {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .party-label {
      font-size: 10px;
      font-weight: 700;
      color: #8899AA;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 6px;
    }
    .party-name {
      font-size: 15px;
      font-weight: 700;
      color: #E8EAF0;
    }
    .party-detail {
      font-size: 12px;
      color: #8899AA;
      margin-top: 3px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 800;
      color: #8899AA;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 14px;
    }
    .line-header {
      display: flex;
      justify-content: space-between;
      padding-bottom: 8px;
      border-bottom: 1px solid #1E3A5F;
      margin-bottom: 10px;
    }
    .line-header span {
      font-size: 11px;
      font-weight: 700;
      color: #8899AA;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .line-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 12px 0;
      border-bottom: 1px solid #1E3A5F;
    }
    .line-desc { flex: 1; }
    .line-desc-main {
      font-size: 14px;
      font-weight: 700;
      color: #E8EAF0;
    }
    .line-desc-detail {
      font-size: 11px;
      color: #8899AA;
      margin-top: 3px;
    }
    .line-amount {
      font-size: 15px;
      font-weight: 800;
      color: #E8EAF0;
      min-width: 80px;
      text-align: right;
      padding-left: 16px;
    }
    .totals { margin-top: 14px; }
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
    }
    .total-row-label {
      font-size: 13px;
      color: #8899AA;
    }
    .total-row-value {
      font-size: 13px;
      font-weight: 600;
      color: #E8EAF0;
    }
    .total-row.total-ttc .total-row-label {
      font-size: 16px;
      font-weight: 800;
      color: #E8EAF0;
    }
    .total-row.total-ttc .total-row-value {
      font-size: 20px;
      font-weight: 900;
      color: #7C6FE0;
    }
    .payment-badge {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 10px;
      padding: 14px 16px;
    }
    .payment-badge-icon { font-size: 22px; }
    .payment-badge-title {
      font-size: 13px;
      font-weight: 800;
      color: #22C55E;
    }
    .payment-badge-sub {
      font-size: 11px;
      color: #8899AA;
      margin-top: 2px;
    }
    .legal {
      font-size: 10px;
      color: #556677;
      line-height: 1.6;
      margin-top: 14px;
    }
    .print-btn {
      display: block;
      width: 100%;
      max-width: 700px;
      margin: 20px auto 0;
      padding: 16px;
      background: #7C6FE0;
      color: #fff;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
      letter-spacing: 0.3px;
    }
    .print-btn:hover { background: #6A5FCC; }
    @media print {
      body { background: #fff !important; color: #111 !important; padding: 0 !important; }
      .header {
        background: #0A1628 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .card { background: #f4f6fa !important; border-color: #dde3ee !important; }
      .print-btn { display: none !important; }
      .logo { color: #7C6FE0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .invoice-num { color: #7C6FE0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .total-row.total-ttc .total-row-value { color: #7C6FE0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .party-name, .line-desc-main, .total-row.total-ttc .total-row-label { color: #111 !important; }
      .party-detail, .line-desc-detail, .invoice-date, .logo-sub, .section-title,
      .total-row-label, .line-header span, .payment-badge-sub, .legal { color: #555 !important; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div>
        <div class="logo">ALANE</div>
        <div class="logo-sub">Plateforme de services à la demande</div>
      </div>
      <div class="invoice-meta">
        <div class="invoice-label">Facture</div>
        <div class="invoice-num">${escHtml(invoiceNum)}</div>
        <div class="invoice-date">Émise le ${escHtml(issueDate)}</div>
      </div>
    </div>

    <div class="card">
      <div class="parties">
        <div>
          <div class="party-label">Client</div>
          <div class="party-name">${escHtml(clientName || "—")}</div>
          ${clientEmail ? `<div class="party-detail">${escHtml(clientEmail)}</div>` : ""}
          ${clientCompany ? `<div class="party-detail">${escHtml(clientCompany)}</div>` : ""}
          ${clientSiret ? `<div class="party-detail">SIRET : ${escHtml(clientSiret)}</div>` : ""}
        </div>
        <div>
          <div class="party-label">Prestataire</div>
          <div class="party-name">${escHtml(prestaName || "—")}</div>
          ${prestaCompany ? `<div class="party-detail">${escHtml(prestaCompany)}</div>` : ""}
          ${prestaSiret ? `<div class="party-detail">SIRET : ${escHtml(prestaSiret)}</div>` : ""}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">Détail de la prestation</div>
      <div class="line-header">
        <span>Description</span>
        <span>Montant HT</span>
      </div>
      <div class="line-item">
        <div class="line-desc">
          <div class="line-desc-main">${escHtml(lineItem)}</div>
          ${secteur ? `<div class="line-desc-detail">Secteur : ${escHtml(secteur)}</div>` : ""}
          ${missionDate ? `<div class="line-desc-detail">Date : ${escHtml(missionDate)}${heureDebut ? " à " + escHtml(heureDebut) : ""}</div>` : ""}
          ${hours > 0 ? `<div class="line-desc-detail">Durée : ${hours}h</div>` : ""}
          ${ville ? `<div class="line-desc-detail">Ville : ${escHtml(ville)}</div>` : ""}
          ${adresse ? `<div class="line-desc-detail">Adresse : ${escHtml(adresse)}</div>` : ""}
        </div>
        <div class="line-amount">${escHtml(htFormatted)} €</div>
      </div>
      <div class="totals">
        <div class="total-row">
          <span class="total-row-label">Sous-total HT</span>
          <span class="total-row-value">${escHtml(htFormatted)} €</span>
        </div>
        <div class="total-row">
          <span class="total-row-label">TVA (0 % — auto-entrepreneur, art. 293 B CGI)</span>
          <span class="total-row-value">0,00 €</span>
        </div>
        <div class="total-row total-ttc">
          <span class="total-row-label">Total TTC</span>
          <span class="total-row-value">${escHtml(htFormatted)} €</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="payment-badge">
        <div class="payment-badge-icon">✅</div>
        <div>
          <div class="payment-badge-title">Mission validée — Paiement reçu</div>
          <div class="payment-badge-sub">Paiement sécurisé via Stripe · Plateforme ALANE</div>
        </div>
      </div>
      <div class="legal">
        TVA non applicable — article 293 B du CGI (auto-entrepreneur). En cas de retard de paiement, des pénalités de retard sont dues selon les articles L.441-6 et D.441-5 du Code de commerce.
        ALANE — Plateforme de mise en relation de services à la demande. Ce document tient lieu de facture acquittée.
      </div>
    </div>

    <button class="print-btn" onclick="window.print()">🖨️ Imprimer / Télécharger en PDF</button>
  </div>
  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
