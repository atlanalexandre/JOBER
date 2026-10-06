import { resendBody } from "./_email.js";
import { sendWebPush, notifier } from "./_push.js";
import { retardMinutes, frenchOffsetMs } from "./_temps.js";
import { appUrl } from "./_url.js";
import { tirerAuHasard } from "./_lots.js";
// Cron — relance des réservations abandonnées
// Déclenché toutes les 30 min par Vercel (vercel.json)
// Pour chaque brouillon > 30 min non encore notifié :
//   1. Push notification (si abonnement existant)
//   2. Email de relance via Resend

// Web Push : le module partagé `_push.js`.

const esc = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();

  const CRON_SECRET      = (process.env.CRON_SECRET || "").replace(/\s/g, "");
  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  const RESEND_API_KEY   = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
  const RESEND_FROM      = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
  const APP_URL          = appUrl();

  if (CRON_SECRET) {
    const auth = req.headers.authorization || "";
    // Comparaison sur les jetons DÉPOUILLÉS : Vercel envoie la valeur brute de
    // CRON_SECRET, que ce fichier lit nettoyée. Une espace invisible dans la
    // variable — le piège documenté de ce projet — suffirait à refuser tous les
    // passages, en silence.
    if (String(auth).replace("Bearer ", "").replace(/\s/g, "") !== CRON_SECRET) {
      console.error("[cron-abandon] appel REFUSÉ (401) — vérifier CRON_SECRET côté Vercel.");
      return res.status(401).json({ error: "Non autorisé" });
    }
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).end();

  const hdrs = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  try {

  // ── Prestataire en retard : heure de début dépassée sans pointage ──────────
  // Ce cron tourne toutes les 30 min, contre 2 h pour celui des rappels : c'est
  // le seul assez fréquent pour un retard. Sans lui, un prestataire qui ne se
  // présente pas n'était relancé qu'à la fin prévue de la prestation — soit
  // après coup sur une prestation d'une heure.
  try {
    const nowMs = Date.now();
    // La date est celle de Paris, pas celle d'UTC : entre minuit et 2 h du matin
    // en France, `toISOString()` renvoie encore la veille et les prestations du
    // jour sortaient du filtre.
    const aujourdhui = new Date(nowMs - frenchOffsetMs(new Date(nowMs))).toISOString().slice(0, 10);
    const rRes = await fetch(
      `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&arrived_at=is.null&started_at=is.null&date=eq.${aujourdhui}`
      + `&select=id,client_id,prestataire_id,metier,sector,ville,date,heure_debut,hours`,
      { headers: hdrs }
    );
    const enCours = rRes.ok ? await rRes.json().catch(() => []) : [];
    for (const m of (Array.isArray(enCours) ? enCours : [])) {
      if (!m.heure_debut) continue;
      // heure_debut est une heure locale française, Vercel tourne en UTC :
      // la conversion passe obligatoirement par _temps.js. Elle manquait ici,
      // et le retard calculé était inférieur de 1 à 2 h au retard réel — la
      // fenêtre ci-dessous ne s'ouvrait donc qu'après 2 h 15 de retard, soit
      // après la fin d'une prestation d'une heure.
      const retard = retardMinutes(m.date, m.heure_debut, nowMs);
      if (retard === null) continue;
      // Fenêtre de 15 à 45 min de retard, large de 30 min comme la période du
      // cron : une prestation en retard y tombe une seule fois, ce qui évite les
      // relances répétées sans colonne dédiée ni migration de schéma.
      // 15 min est le seuil retenu avec Alexandre : en dessous, on alerte pour un
      // simple aléa de circulation.
      if (retard < 15 || retard >= 45) continue;

      const label = m.metier || m.sector || "Prestation";
      try {
        await notifier({
            user_id: m.prestataire_id,
            type: "mission",
            title: `Retard de ${retard} min ⏰`,
            body: `Votre prestation « ${label} »${m.ville ? " à " + m.ville : ""} devait commencer à ${String(m.heure_debut).replace(":","h")}. Signalez votre arrivée dans l'application : le client est informé du retard.`,
          }, SUPABASE_URL, hdrs).catch(e => console.error("[cron-abandon] échec ignoré :", e?.message));
        // Le client est informé aussi : il attendait jusqu'ici sans rien savoir.
        await notifier({
            user_id: m.client_id,
            type: "mission",
            title: "Prestataire en retard ⏰",
            body: `Votre prestataire n'a pas encore signalé son arrivée pour « ${label} », prévue à ${String(m.heure_debut).replace(":","h")}. Vous pouvez le contacter depuis l'application.`,
          }, SUPABASE_URL, hdrs).catch(e => console.error("[cron-abandon] échec ignoré :", e?.message));
      } catch (e) { console.error(`[cron-abandon] relance retard ${m.id} :`, e.message); }
    }
  } catch (e) {
    console.error("[cron-abandon] contrôle des retards échoué :", e.message);
  }

  // Brouillons > 30 min, pas encore notifiés
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Annulation des prestations créées pour un paiement qui n'a jamais abouti.
  // Depuis que la prestation est créée AVANT le paiement (contrainte de
  // /api/stripe-intent, qui recalcule le montant depuis la base), un tunnel
  // abandonné laisse une ligne orpheline visible dans l'espace du client.
  // On croyait que ces trois conditions réunies n'existaient que dans ce cas :
  // c'est faux quand le paiement a abouti mais que l'affectation n'a pas eu lieu.
  //
  // AVANT d'annuler, on demande à Stripe si un paiement de réservation a abouti
  // pour cette prestation (relecture du 04/10/2026). Le webhook ne rattache pas
  // le paiement d'une réservation ordinaire — c'est l'application qui le fait,
  // par `assign_after_payment`. Un client qui fermait l'application juste après
  // avoir payé, ou une affectation en erreur, laissait donc une ligne aux mêmes
  // marqueurs qu'un tunnel abandonné : elle était annulée deux heures plus tard,
  // le client débité sans prestation ni remboursement. Un paiement retrouvé est
  // désormais remboursé avant l'annulation, et le client prévenu.
  try {
    const purgeCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 h
    const filtre = `status=eq.pending_acceptance&prestataire_id=is.null&stripe_payment_intent=is.null`
      // Une semaine de série (seules à porter `parent_mission_id`) dans cet état
      // n'est pas un tunnel abandonné : c'est un prélèvement à l'issue inconnue,
      // laissé en attente pour vérification (relecture du 30/09/2026).
      + `&parent_mission_id=is.null`;
    const candRes = await fetch(
      `${SUPABASE_URL}/rest/v1/missions?${filtre}&created_at=lt.${encodeURIComponent(purgeCutoff)}`
      + `&select=id,client_id,titre,metier&order=created_at.asc&limit=200`,
      { headers: hdrs });
    // 50 tirées AU HASARD parmi les 200 plus anciennes, et non les 50
    // premières : celles qu'on laisse en l'état (Stripe muet, remboursement
    // incomplet) restaient en tête de file et pouvaient bloquer toutes les
    // suivantes — le défaut corrigé le 30/09 dans cron-reset-monthly
    // (relecture du 05/10/2026).
    const candidates = tirerAuHasard(candRes.ok ? await candRes.json().catch(() => []) : [], 50);
    if (!candRes.ok) console.error(`[cron-abandon] prestations non finalisées illisibles (${candRes.status})`);
    const cleStripe = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
    let annulees = 0, remboursees = 0;
    for (const c of (Array.isArray(candidates) ? candidates : [])) {
      // Annulation plutôt que suppression : la ligne garde la trace de ce qui
      // s'est passé. Conditionnée aux mêmes marqueurs : une affectation arrivée
      // entre-temps n'est pas écrasée.
      // Un refus était avalé sans trace (règle 1.2), y compris juste après un
      // remboursement : le client lisait « vous êtes remboursé » d'une
      // réservation restée en attente (relecture du 05/10/2026). Il est
      // désormais journalisé, et le message ne part qu'une fois l'annulation faite.
      const annuler = async () => {
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${c.id}&${filtre}`, {
            method: "PATCH", headers: { ...hdrs, "Prefer": "return=representation" },
            body: JSON.stringify({ status: "cancelled" }),
          });
          if (!r.ok) {
            console.error(`[cron-abandon] annulation de ${c.id} refusée (${r.status}) :`, (await r.text().catch(() => "")).slice(0, 200));
            return [];
          }
          const lignes = await r.json().catch(() => null);
          return Array.isArray(lignes) ? lignes : [];
        } catch (e) {
          console.error(`[cron-abandon] annulation de ${c.id} impossible :`, e.message);
          return [];
        }
      };

      if (!cleStripe) { if ((await annuler()).length) annulees++; continue; }

      let payes;
      try {
        const q = encodeURIComponent(`metadata['mission']:'${c.id}'`);
        const sr = await fetch(`https://api.stripe.com/v1/payment_intents/search?query=${q}&limit=10`,
          { headers: { "Authorization": `Bearer ${cleStripe}` } });
        const sd = await sr.json().catch(() => null);
        if (!sr.ok || !Array.isArray(sd?.data)) throw new Error(`recherche refusée (${sr.status})`);
        payes = sd.data.filter(pi => ["succeeded", "processing", "requires_capture"].includes(pi.status)
          && pi?.metadata?.type !== "heures_supp");
      } catch (e) {
        // Sans réponse de Stripe, on n'annule pas : mieux vaut une réservation
        // en attente quelques heures de plus qu'un paiement perdu.
        console.error(`[cron-abandon] paiement de ${c.id} non vérifiable — annulation reportée :`, e.message);
        continue;
      }

      if (payes.length === 0) { if ((await annuler()).length) annulees++; continue; }

      // Payée, jamais affectée : on ANNULE d'abord, puis on rembourse.
      // L'ordre inverse laissait une fenêtre : une affectation arrivée entre le
      // remboursement et l'annulation donnait une prestation attribuée dont le
      // paiement venait d'être rendu — et l'annulation, ne trouvant plus la
      // ligne, se croyait simplement « à reprendre » (relecture du 06/10/2026).
      // L'annulation conditionnelle PREND la ligne : si elle ne trouve rien, la
      // prestation a été affectée entre-temps, son paiement sert, on n'y touche
      // pas. Même schéma que l'expiration et la clôture de cron-reset-monthly.
      if (!(await annuler()).length) {
        console.log(`[cron-abandon] ${c.id} affectée ou traitée entre-temps — paiement conservé, rien à rembourser.`);
        continue;
      }
      let toutRembourse = true;
      for (const pi of payes) {
        try {
          const rr = await fetch("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: { "Authorization": `Bearer ${cleStripe}`, "Content-Type": "application/x-www-form-urlencoded",
              "Idempotency-Key": `refund-abandon-${c.id}-${pi.id}` },
            body: new URLSearchParams({ payment_intent: pi.id, reason: "requested_by_customer" }).toString(),
          });
          const rd = await rr.json().catch(() => null);
          if (!rd?.id && rd?.error?.code !== "charge_already_refunded") {
            toutRembourse = false;
            console.error(`[cron-abandon] remboursement de ${pi.id} REFUSÉ pour ${c.id} :`, JSON.stringify(rd?.error || rd).slice(0, 200));
          }
        } catch (e) {
          toutRembourse = false;
          console.error(`[cron-abandon] remboursement de ${pi.id} impossible pour ${c.id} :`, e.message);
        }
      }
      if (!toutRembourse) {
        // Remise en attente : la ligne retrouve les marqueurs du filtre et sera
        // reprise au prochain passage. Échec de la remise : à traiter à la main.
        let remise = null;
        try {
          remise = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${c.id}&status=eq.cancelled`, {
            method: "PATCH", headers: { ...hdrs, "Prefer": "return=representation" },
            body: JSON.stringify({ status: "pending_acceptance" }),
          });
        } catch (e) {
          console.error(`[cron-abandon] remise en attente de ${c.id} impossible :`, e.message);
        }
        const remis = remise?.ok ? await remise.json().catch(() => []) : [];
        console.error(`[cron-abandon] ⚠️ prestation ${c.id} PAYÉE, remboursement incomplet : `
          + (Array.isArray(remis) && remis.length ? "remise en attente, reprise au prochain passage."
            : "ANNULÉE SANS REMBOURSEMENT COMPLET et non remise en attente — à traiter à la main."));
        continue;
      }
      remboursees++;
      annulees++;
      if (c.client_id) {
        await notifier({
          user_id: c.client_id, type: "mission",
          title: "Réservation non finalisée — vous êtes remboursé",
          body: `Votre paiement pour « ${c.titre || c.metier || "votre prestation"} » a bien été reçu, mais la réservation n'a pas pu être finalisée. Il vous a été intégralement remboursé. Vous pouvez réserver à nouveau.`,
        }, SUPABASE_URL, hdrs).catch(e => console.error(`[cron-abandon] client ${c.client_id} non prévenu du remboursement :`, e?.message));
      }
    }
    if (annulees || remboursees) {
      console.log(`[cron-abandon] ${annulees} prestation(s) non finalisée(s) annulée(s), dont ${remboursees} payée(s) et remboursée(s)`);
    }
  } catch (e) {
    console.error("[cron-abandon] purge des prestations non payées échouée :", e.message);
  }
  let draftsRes;
  try {
    draftsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/booking_drafts?created_at=lt.${encodeURIComponent(cutoff)}&notified_at=is.null&select=*`,
      { headers: hdrs }
    );
  } catch (e) {
    console.error("[cron-abandon] fetch drafts error:", e.message);
    return res.status(200).json({ ok: true, checked: 0, notified: 0, error: e.message });
  }
  const drafts = draftsRes.ok ? await draftsRes.json().catch(() => []) : [];
  if (!Array.isArray(drafts) || drafts.length === 0) {
    return res.status(200).json({ ok: true, checked: 0, notified: 0 });
  }

  let notified = 0;
  for (const draft of drafts) {
    const presta = draft.prestataire_name ? esc(draft.prestataire_name) : null;
    const metier = draft.metier ? esc(draft.metier) : null;

    // ── 1. Push notification ──────────────────────────────────────────────────
    try {
      const psRes = await fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${draft.client_id}&select=endpoint,p256dh,auth`,
        { headers: hdrs }
      );
      const subs = psRes.ok ? await psRes.json().catch(() => []) : [];
      if (Array.isArray(subs) && subs.length > 0) {
        const pushBody = presta
          ? `${presta} est toujours disponible — finalisez votre prestation en quelques secondes.`
          : "Votre demande n'a pas été finalisée — reprenez où vous en étiez.";
        await Promise.all(subs.map(s => sendWebPush(s, {
          title: "Vous n'avez pas finalisé votre réservation 🔔",
          body: pushBody,
          url: "/",
          tag: "booking-abandon",
        })));
      }
    } catch (e) {
      console.error("[cron-abandon] push error:", e.message);
    }

    // ── 2. Email de relance ───────────────────────────────────────────────────
    if (RESEND_API_KEY) {
      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${draft.client_id}`, { headers: hdrs });
        const uData = uRes.ok ? await uRes.json().catch(() => null) : null;
        const email = uData?.email;
        if (email) {
          const subject = presta
            ? `Votre réservation avec ${presta} n'est pas finalisée`
            : "Vous n'avez pas finalisé votre réservation";
          const detailRows = [
            presta  ? `<tr><td style="padding:6px 0;color:#666;width:120px">Prestataire</td><td style="font-weight:700">${presta}</td></tr>` : "",
            metier  ? `<tr><td style="padding:6px 0;color:#666">Prestation</td><td style="font-weight:700">${metier}</td></tr>` : "",
            draft.date  ? `<tr><td style="padding:6px 0;color:#666">Date</td><td>${esc(draft.date)}</td></tr>` : "",
            draft.ville ? `<tr><td style="padding:6px 0;color:#666">Lieu</td><td>${esc(draft.ville)}</td></tr>` : "",
            draft.montant ? `<tr><td style="padding:6px 0;color:#666">Montant</td><td style="font-weight:700;color:#7C6FE0">${Number(draft.montant).toFixed(2).replace(".",",")} €</td></tr>` : "",
          ].filter(Boolean).join("");
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: resendBody({
              from: RESEND_FROM,
              to: email,
              subject,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
                <h2 style="color:#050E20;margin-bottom:4px">⏳ Vous avez une réservation en attente</h2>
                <p style="color:#444;margin-bottom:20px">Vous avez commencé une demande sur ALANE mais ne l'avez pas finalisée. Il suffit d'un clic pour reprendre là où vous en étiez.</p>
                ${detailRows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;background:#fff;border-radius:10px;padding:16px;display:table">${detailRows}</table>` : ""}
                <a href="${APP_URL}" style="display:inline-block;padding:14px 28px;background:#7C6FE0;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Finaliser ma réservation →</a>
                <p style="margin-top:20px;font-size:12px;color:#888">Si vous ne souhaitez plus faire cette demande, ignorez simplement cet email. · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">ALANE</a></p>
              </div>`,
            }),
          }).catch(e => console.error("[cron-abandon] échec ignoré :", e?.message));
        }
      } catch (e) {
        console.error("[cron-abandon] email error:", e.message);
      }
    }

    // ── 3. Marquer comme notifié ─────────────────────────────────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/booking_drafts?id=eq.${draft.id}`, {
      method: "PATCH",
      headers: { ...hdrs, "Prefer": "return=minimal" },
      body: JSON.stringify({ notified_at: new Date().toISOString() }),
    }).catch(e => console.error("[cron-abandon] échec ignoré :", e?.message));

    notified++;
  }

  console.log(`[cron-abandon] checked=${drafts.length} notified=${notified}`);
  return res.status(200).json({ ok: true, checked: drafts.length, notified });

  } catch (e) {
    console.error("[cron-abandon] unhandled error:", e.message, e.stack);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
