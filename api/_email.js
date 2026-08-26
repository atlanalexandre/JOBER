import crypto from "crypto";
import { appUrl } from "./_url.js";

export function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

export function hashPii(value) {
  if (value == null) return null;
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

export function emailHtml(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,Helvetica Neue,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
        <tr>
          <td style="background:#050E20;padding:28px 36px;text-align:center;">
            <span style="font-size:28px;font-weight:800;letter-spacing:2px;">
              <span style="color:#7C6FE0;">A</span><span style="color:#ffffff;">LAN</span><span style="color:#F0B429;">E</span>
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:36px;color:#1a1a2e;font-size:15px;line-height:1.7;">
            ${content}
          </td>
        </tr>
        <tr>
          <td style="background:#f4f4f7;padding:20px 36px;text-align:center;border-top:1px solid #e8e8f0;">
            <p style="margin:0;font-size:13px;color:#888;">L'équipe <strong>ALANE</strong> · <a href='${appUrl()}' style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Version texte dérivée du HTML. Un email sans alternative texte est un signal
// de spam classique : les filtres considèrent qu'un expéditeur légitime en
// fournit toujours une. Les emails du projet étaient tous en HTML seul.
export function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, txt) =>
      `${txt.replace(/<[^>]+>/g, "").trim()} : ${href}`)
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Corps de requête pour l'API Resend. À utiliser partout à la place de
// JSON.stringify : sur 31 envois, un seul fournissait une alternative texte et
// aucun n'indiquait d'adresse de réponse. Un email HTML seul, expédié depuis une
// adresse « no-reply » sans Reply-To, coche deux critères de spam que Gmail
// applique d'autant plus durement à un domaine récent — d'où les confirmations
// de commande retrouvées dans les indésirables.
export function resendBody(payload) {
  const corps = { ...payload };
  if (corps.html && !corps.text) corps.text = htmlToText(corps.html);
  if (!corps.reply_to) {
    const repondreA = (process.env.RESEND_REPLY_TO || "").replace(/\s/g, "");
    if (repondreA) corps.reply_to = repondreA;
  }
  return JSON.stringify(corps);
}

export async function sendEmail({ to, subject, html }) {
  const key  = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  // Sans clé, aucun email ne part et rien ne le signalait : ni ici, ni côté
  // front où les appels sont en .catch(()=>{}). Un envoi manquant devient donc
  // invisible de bout en bout (règle 1.2).
  if (!key) {
    console.error(`[email] RESEND_API_KEY absente — email « ${subject} » NON envoyé.`);
    return;
  }
  if (!process.env.RESEND_FROM) {
    console.error("[email] RESEND_FROM absente : expéditeur de repli onboarding@resend.dev, "
      + "que Resend n'autorise qu'à destination du titulaire du compte. Les autres destinataires seront rejetés.");
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: resendBody({ from, to: [to], subject, html }),
      });
      if (r.ok) { console.log(`[email] « ${subject} » accepté par Resend.`); return true; }
      const body = await r.text();
      console.error(`[email] Resend a REFUSÉ « ${subject} » (essai ${attempt + 1}) :`, r.status, body);
      if (r.status < 500) return false;
      if (attempt === 0) await new Promise(r2 => setTimeout(r2, 2000));
    } catch (e) {
      console.error(`sendEmail error (attempt ${attempt + 1}):`, e);
      if (attempt === 0) await new Promise(r2 => setTimeout(r2, 2000));
    }
  }
}
