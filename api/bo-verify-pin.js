import crypto from "crypto";

function genToken(secret) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(8).toString("hex");
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${nonce}`).digest("hex");
  return `${ts}.${nonce}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const xfwd = req.headers["x-forwarded-for"] || "";
  const ip = (xfwd ? xfwd.split(",").at(-1).trim() : null) || req.socket?.remoteAddress || "unknown";
  const now = Date.now();

  // Sanitize : supprime espaces/sauts de ligne (copier-coller iPad/mobile)
  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  const BO_PASSWORD      = (process.env.BO_PASSWORD || "").replace(/\s/g, "") || undefined;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: "Configuration Supabase manquante" });
  }

  // BO_SESSION_SECRET optionnel : dérivé de SERVICE_ROLE_KEY si absent
  const BO_SECRET = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "") ||
    crypto.createHmac("sha256", SERVICE_ROLE_KEY).update("bo-session-fallback").digest("hex");

  // Si BO_PASSWORD non configuré → mot de passe temporaire affiché à l'admin
  const tempPassword = crypto.createHmac("sha256", SERVICE_ROLE_KEY).update("bo-temp-access").digest("hex").slice(0, 16);
  const effectivePassword = BO_PASSWORD || tempPassword;
  const usingTempPassword = !BO_PASSWORD;

  const rlHeaders = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  // Rate-limit persistant : 10 tentatives / 5 min par IP
  let attempts = 1;
  try {
    const rlRes  = await fetch(`${SUPABASE_URL}/rest/v1/bo_rate_limits?ip=eq.${encodeURIComponent(ip)}&select=attempts,reset_at`, { headers: rlHeaders });
    const rlData = rlRes.ok ? await rlRes.json().catch(() => []) : [];
    const rec    = Array.isArray(rlData) && rlData[0];

    if (rec && new Date(rec.reset_at) > new Date()) {
      attempts = (rec.attempts || 0) + 1;
      await fetch(`${SUPABASE_URL}/rest/v1/bo_rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
        method: "PATCH",
        headers: { ...rlHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({ attempts }),
      }).catch(() => {});
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/bo_rate_limits`, {
        method: "POST",
        headers: { ...rlHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ ip, attempts: 1, reset_at: new Date(now + 300_000).toISOString() }),
      }).catch(() => {});
      attempts = 1;
    }
  } catch { /* DB indisponible — on continue sans bloquer */ }

  if (attempts > 10) {
    return res.status(429).json({ ok: false, error: "Trop de tentatives — réessayez dans 5 minutes" });
  }

  // Le mot de passe de repli n'est JAMAIS transmis au navigateur.
  //
  // Il l'était : lorsque BO_PASSWORD n'était pas configuré, la réponse à un
  // appel anonyme — sans mot de passe, ou avec un mot de passe faux — contenait
  // `tempPassword`, et l'écran de connexion l'affichait avec un bouton pour s'en
  // servir. Une variable d'environnement absente ou mal orthographiée ouvrait
  // donc le backoffice à quiconque ouvrait admin.alane.fr.
  //
  // Il reste accepté comme mot de passe — sans lui, un déploiement neuf
  // enfermerait dehors le propriétaire du projet — mais il ne se lit plus que
  // dans les journaux Vercel, auxquels seul ce dernier a accès.
  if (usingTempPassword) {
    console.error(
      "[bo-verify-pin] BO_PASSWORD n'est pas configuré. Mot de passe de repli — "
      + "à utiliser une seule fois, puis définir BO_PASSWORD dans Vercel : " + tempPassword
    );
  }

  const { pin } = req.body || {};
  if (!pin || typeof pin !== "string") {
    return res.status(400).json({ ok: false, ...(usingTempPassword && { needsSetup: true }) });
  }

  await new Promise(r => setTimeout(r, Math.min(attempts * 400, 3000)));

  // BOM, espace insécable, espace insécable étroit, gluon de mots — ajoutés par
  // certains gestionnaires de mots de passe au copier-coller.
  const sanitize = s => s.replace(/[\uFEFF\u00A0\u202F\u2060]/g, "").trim();
  const expected = sanitize(effectivePassword);
  const received = sanitize(pin);
  let pinOk = false;
  try {
    const bufE = Buffer.from(expected, "utf8");
    const bufR = Buffer.from(received, "utf8");
    if (bufE.length === bufR.length) {
      pinOk = crypto.timingSafeEqual(bufE, bufR);
    }
  } catch { pinOk = false; }

  if (!pinOk) {
    // Une tentative ratée ne dit rien de plus que « raté ».
    //
    // La réponse contenait auparavant, pour tout appelant anonyme : la LONGUEUR
    // exacte de BO_PASSWORD, l'environnement Vercel, et la LISTE DES NOMS des
    // variables d'environnement contenant « BO » ou « PASSWORD ». La longueur
    // d'un mot de passe réduit considérablement l'espace de recherche d'une
    // attaque par force brute, et la liste des variables renseigne sur la
    // configuration du projet. Le tout sans authentification.
    //
    // Le diagnostic qui a motivé ces champs a sa place dans les journaux
    // serveur, pas dans une réponse HTTP publique.
    console.error(`[bo-verify-pin] tentative refusée depuis ${ip} `
      + `(essai ${attempts}/10, BO_PASSWORD ${process.env.BO_PASSWORD ? "défini" : "ABSENT"})`);
    return res.status(401).json({ ok: false, ...(usingTempPassword && { needsSetup: true }) });
  }

  // Succès : réinitialiser le compteur
  fetch(`${SUPABASE_URL}/rest/v1/bo_rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
    method: "DELETE",
    headers: { ...rlHeaders, "Prefer": "return=minimal" },
  }).catch(() => {});

  const token = genToken(BO_SECRET);
  return res.status(200).json({ ok: true, token, ...(usingTempPassword && { needsSetup: true }) });
}
