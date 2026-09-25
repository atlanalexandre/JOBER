// Prévenir un prestataire qu'une prestation lui est proposée.
//
// Module partagé : `api/missions.js` (affectation par le client, par la
// plateforme, cascade) et `api/_recurrence.js` (semaine suivante d'une série)
// passent par ici, pour qu'un prestataire soit prévenu de la même façon quel
// que soit le chemin qui l'a désigné.
import { resendBody, euros } from "./_email.js";
import { notifier } from "./_push.js";
import { texteDelaiReponse } from "./_temps.js";
import { appUrl } from "./_url.js";

const esc = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const smsClean = (s, max = 160) => String(s||"").replace(/[\r\n\t]/g," ").trim().slice(0, max);

// Prévient un prestataire qu'une prestation lui est proposée : notification
// (dans l'application et sur son téléphone), e-mail avec réponse en un clic, SMS.
//
// Appelée par le SERVEUR à chaque affectation — choix du client
// (`assign_after_payment`), affectation par la plateforme (`affecter_tiers`),
// passage au candidat suivant (cascade). Tout est relu dans la base.
//
// Le navigateur déclenchait lui-même cet envoi (`notify_prestataire`), avec des
// données qu'il fournissait. Trois défauts en découlaient :
//   • le tarif affiché était le tarif de base, même en urgence ;
//   • sur une prestation chez un tiers, le serveur choisit le prestataire, mais
//     c'est celui de l'écran qu'on tentait de prévenir — le vrai n'était pas averti ;
//   • en cascade, le prestataire suivant n'était prévenu par rien.
export async function prevenirNouvelleDemande(missionId, supabaseUrl, headers) {
  const mr = await fetch(
    `${supabaseUrl}/rest/v1/missions?id=eq.${missionId}&status=eq.pending_acceptance`
    + `&select=id,prestataire_id,titre,metier,sector,date,heure_debut,hours,ville,adresse,tarif_horaire,acceptance_deadline&limit=1`,
    { headers }
  );
  const lignes = await mr.json().catch(() => null);
  const m = Array.isArray(lignes) ? lignes[0] : null;
  if (!mr.ok || !m || !m.prestataire_id) {
    console.error(`[nouvelle_demande] prestation ${missionId} illisible ou non affectée (${mr.status}) — prestataire NON prévenu.`);
    return;
  }
  const prestataireId = m.prestataire_id;
  const echeanceMs = m.acceptance_deadline ? new Date(m.acceptance_deadline).getTime() : null;
  const delai = texteDelaiReponse(echeanceMs);
  const libelle = m.titre || m.metier || "Prestation";
  const tarif = Number(m.tarif_horaire) > 0 ? euros(m.tarif_horaire) : "";

  await notifier({
      user_id: prestataireId,
      type:    "prestation",
      title:   "Nouvelle demande de prestation",
      body:    `${libelle}${m.date ? " · " + m.date : ""}${m.ville ? " · " + m.ville : ""}. ${delai.phrase}`,
      ref_id:  m.id,
    }, supabaseUrl, headers).catch(e => console.error("[nouvelle_demande] notification échouée :", e.message));

  let ud;
  try {
    const ur = await fetch(`${supabaseUrl}/auth/v1/admin/users/${prestataireId}`, { headers });
    ud = await ur.json();
  } catch (e) {
    console.error(`[nouvelle_demande] compte ${prestataireId} illisible — e-mail et SMS NON envoyés :`, e.message);
    return;
  }
  const prestaEmail = ud.email;
  const phone = ud.user_metadata?.telephone;
  const prestaName = ud.user_metadata?.prenom || "Prestataire";

  const sLabel = esc(libelle);
  const sDate  = esc(m.date || "Date à confirmer");
  const sVille = esc(m.ville || "Ville à confirmer");
  const sHdeb  = esc(m.heure_debut ? String(m.heure_debut).slice(0, 5) : "");
  const sAdresse = esc(m.adresse || "");
  const sHours = esc(String(m.hours || "?").replace(".", ","));
  const sFin = sHdeb && m.hours ? (() => {
    const [h, mi] = sHdeb.split(":").map(Number);
    const t = h * 60 + mi + Math.round(Number(m.hours) * 60);
    return String(Math.floor(t / 60) % 24).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  })() : "";

  const RESEND_KEY  = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
  const RESEND_FROM = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
  if (!RESEND_KEY) console.error("[nouvelle_demande] RESEND_API_KEY absente — e-mail au prestataire NON envoyé.");
  if (!prestaEmail) console.error(`[nouvelle_demande] aucune adresse e-mail pour ${prestataireId} — e-mail NON envoyé.`);
  if (RESEND_KEY && prestaEmail) {
    // Liens de réponse en un clic, valables jusqu'à l'échéance de réponse :
    // au-delà, la demande est expirée et le serveur refuserait de toute façon.
    const EMAIL_SECRET = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");
    let acceptUrl = `${appUrl()}/api/missions?action=accept&m=${m.id}&p=${prestataireId}`;
    let refuseUrl = `${appUrl()}/api/missions?action=refuse&m=${m.id}&p=${prestataireId}`;
    if (EMAIL_SECRET) {
      const { createHmac } = await import("crypto");
      const exp = Math.floor((echeanceMs || Date.now() + 86400000) / 1000);
      const makeToken = (act) => createHmac("sha256", EMAIL_SECRET).update(`${act}.${m.id}.${prestataireId}.${exp}`).digest("base64url");
      acceptUrl += `&exp=${exp}&sig=${encodeURIComponent(makeToken("accept"))}`;
      refuseUrl += `&exp=${exp}&sig=${encodeURIComponent(makeToken("refuse"))}`;
    }
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: resendBody({
          from: RESEND_FROM,
          to: [prestaEmail],
          subject: "🔔 Nouvelle demande de prestation — répondez rapidement !",
          // Version texte : sans elle, l'email part en HTML seul, ce qui pèse
          // lourd dans le classement en spam. Les liens d'acceptation et de
          // refus y sont repris en clair pour rester utilisables.
          text: `Nouvelle demande de prestation sur ALANE\n\n${sLabel} — ${sVille}\n${sDate}${sHdeb ? " à " + sHdeb : ""}\n${sHours} h${tarif ? " · " + tarif + "/h HT" : ""}\n${sAdresse ? sAdresse + "\n" : ""}\n${delai.phrase}\n\nAccepter : ${acceptUrl}\nRefuser : ${refuseUrl}\n\nL'équipe ALANE`,
          html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
            <h2 style="color:#A29BFE;margin:0 0 12px">Nouvelle demande de prestation 🔔</h2>
            <p>Bonjour ${esc(prestaName)},</p>
            <p>Une prestation vous est proposée :</p>
            <div style="background:#162547;border-left:4px solid #A29BFE;padding:12px 16px;margin:16px 0;border-radius:4px">
              <strong style="font-size:15px">${sLabel}</strong><br/>
              📅 ${sDate}${sHdeb ? ` · ${sHdeb}` : ""}${sFin ? ` → ${sFin}` : ""}<br/>
              ⏱ ${sHours} h de travail${tarif ? ` · ${tarif}/h HT` : ""}<br/>
              📍 ${sAdresse ? `${sAdresse}, ` : ""}${sVille}
            </div>
            <p style="margin:20px 0 8px">Répondez directement depuis cet email :</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="padding-right:8px"><a href="${acceptUrl}" style="display:block;text-align:center;background:#10D98F;color:#fff;text-decoration:none;padding:13px 0;border-radius:10px;font-weight:700;font-size:15px">✅ Accepter</a></td>
              <td style="padding-left:8px"><a href="${refuseUrl}" style="display:block;text-align:center;background:#F25E5E;color:#fff;text-decoration:none;padding:13px 0;border-radius:10px;font-weight:700;font-size:15px">❌ Refuser</a></td>
            </tr></table>
            <p style="margin-top:16px;font-size:13px;color:rgba(255,255,255,0.7)">${delai.phrase} Passé ce délai, la demande expire.</p>
            <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
          </div>`,
        }),
      });
      if (!r.ok) console.error(`[nouvelle_demande] e-mail refusé par Resend pour ${m.id} : ${r.status}`);
    } catch (e) {
      console.error(`[nouvelle_demande] e-mail NON envoyé pour ${m.id} :`, e.message);
    }
  }

  const BREVO_KEY = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
  if (BREVO_KEY && phone) {
    const digits = String(phone).replace(/\D/g, "");
    const e164 = digits.startsWith("0") ? "33" + digits.slice(1) : digits.startsWith("33") ? digits : null;
    if (e164) {
      try {
        const r = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
          method: "POST",
          headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: "ALANE",
            recipient: e164,
            content: smsClean(`ALANE - Demande de prestation : ${libelle} le ${m.date || "?"} à ${m.ville || "?"}. ${delai.phrase} — alane.fr`),
          }),
        });
        if (!r.ok) console.error(`[nouvelle_demande] SMS refusé par Brevo pour ${m.id} : ${r.status}`);
      } catch (e) {
        console.error(`[nouvelle_demande] SMS NON envoyé pour ${m.id} :`, e.message);
      }
    }
  }
}
