export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { prenom, nom, email, role } = req.body || {};
  if (!prenom || !nom || !email || !role) return res.status(400).json({ error: "Missing fields" });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM    = process.env.RESEND_FROM;
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;

  console.log("notify-admin — RESEND_API_KEY:", RESEND_API_KEY ? "set" : "MISSING");
  console.log("notify-admin — RESEND_FROM:", RESEND_FROM || "MISSING");
  console.log("notify-admin — ADMIN_EMAIL:", ADMIN_EMAIL || "MISSING");

  if (!RESEND_API_KEY || !ADMIN_EMAIL || !RESEND_FROM) {
    console.error("notify-admin — variables manquantes, email non envoyé");
    return res.status(200).json({ ok: true, warning: "email skipped, missing env vars" });
  }

  const roleLabel = role === "prestataire" ? "Prestataire" : "Client";

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [ADMIN_EMAIL],
        subject: `Nouvelle inscription ${roleLabel} — ${prenom} ${nom}`,
        html: `
          <p>Un nouveau compte est en attente de validation.</p>
          <ul>
            <li><strong>Nom :</strong> ${prenom} ${nom}</li>
            <li><strong>Email :</strong> ${email}</li>
            <li><strong>Rôle :</strong> ${roleLabel}</li>
          </ul>
          <p>Connectez-vous au backoffice pour approuver ou refuser ce compte.</p>
        `,
      }),
    });
    const result = await r.text();
    console.log("notify-admin — Resend status:", r.status, "| response:", result);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("notify-admin — fetch error:", e);
    return res.status(200).json({ ok: true, warning: "email failed" });
  }
}
