export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { prenom, nom, email, role } = req.body || {};
  if (!prenom || !nom || !email || !role) return res.status(400).json({ error: "Missing fields" });

  const roleLabel = role === "prestataire" ? "Prestataire" : "Client";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: process.env.ADMIN_EMAIL,
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

  res.status(200).json({ ok: true });
}
