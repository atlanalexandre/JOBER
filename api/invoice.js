/* eslint-disable no-irregular-whitespace */
// /api/invoice.js — Serverless function that returns a printable HTML invoice
// Auth: token éphémère signé HMAC-SHA256 (via /api/missions action generate_invoice_token)
//       Valide 30 min — jamais le JWT Supabase en clair dans l'URL

import crypto from "crypto";

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function verifyInvoiceToken(token, missionId, secret) {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userId, tokenMissionId, expStr, sig] = parts;
  if (tokenMissionId !== missionId) return null;
  const exp = parseInt(expStr, 10);
  if (isNaN(exp) || Math.floor(Date.now() / 1000) > exp) return null;
  const data2sign = `${userId}.${tokenMissionId}.${expStr}`;
  const expected = crypto.createHmac("sha256", secret).update(data2sign).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch { return null; }
  return userId;
}

export default async function handler(req, res) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  const boSecret = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");

  if (!supabaseUrl || !serviceRoleKey || !boSecret) {
    return res.status(500).send("<h1>Configuration serveur manquante</h1>");
  }

  const { mission_id, token } = req.query;

  if (!mission_id || typeof mission_id !== "string" || !/^[0-9a-f-]{36}$/i.test(mission_id)) {
    return res.status(400).send("<h1>mission_id invalide</h1>");
  }

  // Verify signed ephemeral token (not the raw JWT — never put JWTs in URLs)
  const userId = verifyInvoiceToken(token, mission_id, boSecret);
  if (!userId) {
    return res.status(401).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#0A1628;color:#E8EAF0"><h2>Lien expiré ou invalide</h2><p>Le lien de facture est valable 30 minutes. <a href="/" style="color:#7C6FE0">Retourner à l'application</a> pour en générer un nouveau.</p></body></html>`);
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
    return res.status(500).send("<h1>Erreur lors de la récupération de la prestation</h1>");
  }
  const missions = await missionRes.json();
  const mission = missions[0];

  if (!mission) {
    return res.status(404).send("<h1>Mission introuvable</h1>");
  }

  // Double-check ownership (userId extracted from signed token)
  if (mission.client_id !== userId && mission.prestataire_id !== userId) {
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
  let prestaStatutPro = "auto-entrepreneur";

  if (mission.prestataire_id) {
    const [prestaProfileRes, prestaAuthRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(mission.prestataire_id)}&select=prenom,nom,societe_nom,siret`, {
        headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}`, "Accept": "application/json" },
      }),
      fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(mission.prestataire_id)}`, {
        headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}` },
      }),
    ]);
    if (prestaProfileRes.ok) {
      const profiles = await prestaProfileRes.json();
      const p = profiles[0];
      if (p) {
        prestaName = [p.prenom, p.nom].filter(Boolean).join(" ") || "Prestataire";
        prestaCompany = p.societe_nom || "";
        prestaSiret = p.siret || "";
      }
    }
    if (prestaAuthRes.ok) {
      const prestaAuth = await prestaAuthRes.json();
      const sp = prestaAuth?.user_metadata?.statut_pro || "auto-entrepreneur";
      prestaStatutPro = sp;
    }
  }

  // Numérotation séquentielle.
  //
  // Un nouveau numéro était tiré à CHAQUE affichage de la facture : la même
  // prestation en changeait à chaque ouverture, et le compteur grimpait à chaque
  // consultation. Or l'article 242 nonies A de l'annexe II au CGI impose une
  // numérotation continue, sans rupture, et un numéro qui identifie durablement la
  // facture. Le numéro est donc attribué une seule fois puis conservé sur la
  // prestation ; les affichages suivants le relisent.
  const hdrsDB = { "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", "Prefer": "return=representation" };
  let invoiceNum = mission.invoice_number || null;

  if (!invoiceNum) {
    let numeroTire = null;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const seqRes = await fetch(`${supabaseUrl}/rest/v1/platform_settings?key=eq.invoice_sequence&select=value`, { headers: hdrsDB });
        const seqData = await seqRes.json();
        const currentVal = Array.isArray(seqData) && seqData[0] ? Number(seqData[0].value) : 0;
        const nextVal = currentVal + 1;
        const patchRes = await fetch(
          `${supabaseUrl}/rest/v1/platform_settings?key=eq.invoice_sequence&value=eq.${currentVal}`,
          { method: "PATCH", headers: hdrsDB, body: JSON.stringify({ value: nextVal, updated_at: new Date().toISOString() }) }
        );
        const patched = await patchRes.json().catch(() => []);
        if (Array.isArray(patched) && patched.length > 0) {
          numeroTire = `FAC-${new Date().getFullYear()}-${String(nextVal).padStart(6, "0")}`;
          break;
        }
        await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
      }
    } catch (seqErr) {
      console.error("[invoice] compteur illisible :", seqErr.message);
    }

    if (numeroTire) {
      // Le filtre sur invoice_number garantit qu'un seul affichage simultané fixe le
      // numéro. Le perdant relit celui du gagnant plutôt que d'afficher le sien.
      try {
        const fixRes = await fetch(
          `${supabaseUrl}/rest/v1/missions?id=eq.${encodeURIComponent(mission_id)}&invoice_number=is.null`,
          { method: "PATCH", headers: hdrsDB, body: JSON.stringify({ invoice_number: numeroTire }) }
        );
        const fixes = await fixRes.json().catch(() => []);
        if (Array.isArray(fixes) && fixes.length > 0) {
          invoiceNum = numeroTire;
        } else if (fixRes.ok) {
          const relu = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${encodeURIComponent(mission_id)}&select=invoice_number`, { headers: hdrsDB });
          invoiceNum = ((await relu.json().catch(() => []))[0] || {}).invoice_number || numeroTire;
        } else {
          // Colonne absente : migration 2026-07-30_facture_numero_stable non appliquée.
          const txt = await fixRes.text().catch(() => "");
          console.error("[invoice] numéro NON conservé — la facture changera de numéro à chaque affichage. "
            + `Appliquer la migration 2026-07-30_facture_numero_stable.sql. Détail : ${fixRes.status} ${txt}`);
          invoiceNum = numeroTire;
        }
      } catch (e) {
        console.error("[invoice] conservation du numéro impossible :", e.message);
        invoiceNum = numeroTire;
      }
    }
  }

  if (!invoiceNum) invoiceNum = `FAC-${mission_id.slice(0, 8).toUpperCase()}`;
  const today = new Date();
  const issueDate = today.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const hours = Number(mission.actual_hours ?? mission.hours ?? 0);
  const tarifHoraire = Number(mission.tarif_horaire || 0);
  // Le nombre de jours était omis : une prestation récurrente de 5 jours était
  // facturée une seule journée, comme elle n'était payée qu'une journée au
  // prestataire. La facture doit refléter ce qui est réellement dû.
  const nbJours = (mission.date_debut && mission.date_fin)
    ? Math.max(1, Math.round((new Date(mission.date_fin) - new Date(mission.date_debut)) / 86400000) + 1)
    : 1;
  const htCalc = Math.round(hours * tarifHoraire * nbJours * 100) / 100;
  // Repli sur montant_total seulement s'il n'y a rien à calculer. Il inclut les frais
  // de service d'ALANE, qui ne relèvent pas de la facture du prestataire : c'est un
  // pis-aller, signalé pour qu'il ne passe pas inaperçu.
  if (htCalc <= 0) {
    console.error(`[invoice] tarif ou durée absents sur la prestation ${mission_id} — `
      + `repli sur montant_total, qui inclut les frais de service.`);
  }
  const ht = htCalc > 0 ? htCalc : Number(mission.montant_total || 0);
  const htFormatted = ht.toFixed(2).replace(".", ",");

  // TVA : 0% pour auto-entrepreneur (art. 293 B CGI), 20% pour les autres statuts
  const isAutoEntrepreneur = prestaStatutPro.toLowerCase().includes("auto");
  const tvaRate = isAutoEntrepreneur ? 0 : 0.20;
  const tvaAmount = Math.round(ht * tvaRate * 100) / 100;
  const ttc = Math.round((ht + tvaAmount) * 100) / 100;
  const tvaFormatted = tvaAmount.toFixed(2).replace(".", ",");
  const ttcFormatted = ttc.toFixed(2).replace(".", ",");
  const tvaLabel = isAutoEntrepreneur
    ? "TVA (0 % — auto-entrepreneur, art. 293 B CGI)"
    : "TVA (20 %)";
  const legalTvaNote = isAutoEntrepreneur
    ? "TVA non applicable — article 293 B du CGI (auto-entrepreneur)."
    : `TVA de 20 % applicable. SIRET : ${escHtml(prestaSiret || "—")}. En cas de retard de paiement, des pénalités de retard sont dues selon les articles L.441-6 et D.441-5 du Code de commerce.`;

  const missionDate = mission.date || "";
  const heureDebut = mission.heure_debut || "";
  const metier = mission.metier || "Prestation de service";
  const secteur = mission.sector || "";
  const ville = mission.ville || "";
  const adresse = mission.adresse || "";

  const lineItem = htCalc > 0
    ? `${metier} — ${hours}h × ${tarifHoraire.toFixed(2).replace(".", ",")} €/h`
      + (nbJours > 1 ? ` × ${nbJours} jours` : "")
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
          <span class="total-row-label">${escHtml(tvaLabel)}</span>
          <span class="total-row-value">${escHtml(tvaFormatted)} €</span>
        </div>
        <div class="total-row total-ttc">
          <span class="total-row-label">Total TTC</span>
          <span class="total-row-value">${escHtml(ttcFormatted)} €</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="payment-badge">
        <div class="payment-badge-icon">✅</div>
        <div>
          <div class="payment-badge-title">Prestation validée — Paiement reçu</div>
          <div class="payment-badge-sub">Paiement sécurisé via Stripe · Plateforme ALANE</div>
        </div>
      </div>
      <div class="legal">
        ${escHtml(legalTvaNote)}
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
