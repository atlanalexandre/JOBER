// Vercel Edge Middleware — protection IP du backoffice
/* global process */
export const config = {
  matcher: ["/bo", "/bo/:path*", "/api/bo-action", "/api/bo-verify-pin"],
};

export default function middleware(request) {
  try {
    const BO_ALLOWED_IPS = process.env.BO_ALLOWED_IPS;

    // Variable non configurée → pas de restriction
    if (!BO_ALLOWED_IPS || !BO_ALLOWED_IPS.trim()) return;

    const rawIp = request.ip || null;
    const ip = rawIp ? rawIp.replace(/^::ffff:/i, "") : null;
    const allowed = BO_ALLOWED_IPS.split(",").map((s) => s.trim().replace(/^::ffff:/i, "")).filter(Boolean);

    if (!ip || !allowed.includes(ip)) {
      const pathname = new URL(request.url).pathname;
      const isApiRoute = pathname.startsWith("/api/");
      if (isApiRoute) {
        return new Response(
          JSON.stringify({ error: "Accès refusé — IP non autorisée" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><title>403 – Accès refusé</title>
        <style>body{font-family:system-ui,sans-serif;background:#050E20;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
        .box{text-align:center;padding:40px}h1{font-size:2rem;margin-bottom:8px}p{color:#8892a4;font-size:0.95rem}</style></head>
        <body><div class="box"><h1>403</h1><p>Accès réservé aux administrateurs.</p></div></body></html>`,
        { status: 403, headers: { "Content-Type": "text/html;charset=utf-8" } }
      );
    }
  } catch (err) {
    void err;
    return;
  }
}
