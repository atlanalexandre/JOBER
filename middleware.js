// Vercel Edge Middleware — protection IP du backoffice + redirect admin.alane.fr → /bo
/* global process */
export const config = {
  matcher: ["/bo", "/bo/:path*", "/api/bo-action", "/api/bo-verify-pin", "/", "/((?!_next|assets|api).*)"],
};

export default function middleware(request) {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") || "";

    // Redirect admin.alane.fr → /bo (sauf si déjà sur /bo)
    if (host === "admin.alane.fr") {
      if (!url.pathname.startsWith("/bo")) {
        return Response.redirect(`https://admin.alane.fr/bo${url.pathname === "/" ? "" : url.pathname}${url.search}`, 301);
      }
      // Sur admin.alane.fr/bo/* : laisser passer (protection IP s'applique ensuite)
    }

    const BO_ALLOWED_IPS = process.env.BO_ALLOWED_IPS;

    // Pas de restriction IP configurée → laisser passer
    if (!BO_ALLOWED_IPS || !BO_ALLOWED_IPS.trim()) return;

    // Appliquer la restriction IP uniquement aux routes BO
    const pathname = url.pathname;
    const isBoRoute = pathname.startsWith("/bo") || pathname.startsWith("/api/bo-action") || pathname.startsWith("/api/bo-verify-pin");
    if (!isBoRoute) return;

    const rawIp = request.ip || null;
    const ip = rawIp ? rawIp.replace(/^::ffff:/i, "") : null;
    const allowed = BO_ALLOWED_IPS.split(",").map((s) => s.trim().replace(/^::ffff:/i, "")).filter(Boolean);

    if (!ip || !allowed.includes(ip)) {
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
