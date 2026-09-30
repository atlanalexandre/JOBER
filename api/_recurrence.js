// Prestations récurrentes (chaque semaine) : chaque prestation se paie à son tour.
//
// Décidé le 25/09/2026 : le client ne paie jamais la série d'avance. La première
// semaine se réserve et se paie comme n'importe quelle prestation, carte
// enregistrée avec son accord exprès. Ensuite, à la validation de chaque semaine
// — par le client ou automatiquement —, la suivante est créée chez le MÊME
// prestataire, au même tarif, et payée seule, sur cette carte. Le prestataire est
// prévenu et l'accepte comme une réservation ordinaire ; son versement suit la
// règle commune : 48 h après la fin de CETTE prestation.
//
// Ce qui a été remplacé : la semaine suivante naissait « open », sans
// prestataire, sans paiement ni montant, dans une place de marché où personne ne
// peut postuler — et le client lisait « programmée ». Constaté en recette le
// 25/09/2026.
//
// Tout part de la base et de Stripe, jamais du navigateur : prix, carte,
// prestataire.
import { calculerFrais, lireFraisService } from "./_montant.js";
import { delaiReponseMinutes } from "./_paiement.js";
import { notifier } from "./_push.js";
import { euros, sendEmail, esc } from "./_email.js";
import { prevenirNouvelleDemande } from "./_nouvelle_demande.js";

const PAS_JOURS = { weekly: 7, biweekly: 14 };

/** Date de la prochaine occurrence (AAAA-MM-JJ), ou null si la récurrence est inconnue. */
export function dateSuivante(date, recurrence) {
  const d = new Date(`${String(date).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (PAS_JOURS[recurrence]) {
    d.setUTCDate(d.getUTCDate() + PAS_JOURS[recurrence]);
  } else if (recurrence === "monthly") {
    const jour = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + 1);
    if (d.getUTCDate() !== jour) d.setUTCDate(0); // 31 janvier → 28 février
  } else {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

/** Prix de l'occurrence suivante : la part horaire, et les frais d'une prestation simple. */
export function montantOccurrence(tarifHoraire, heures, frais) {
  const part = Math.round(Number(tarifHoraire || 0) * Number(heures || 0) * 100) / 100;
  if (!(part > 0)) return null;
  return Math.round((part + calculerFrais("single", part, 1, frais)) * 100) / 100;
}

const dateFr = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
  weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris",
});

/**
 * Crée ET paie l'occurrence suivante d'une prestation récurrente qui vient d'être
 * validée. Idempotente : une occurrence déjà créée n'est jamais recréée, et la clé
 * d'idempotence Stripe interdit un second prélèvement.
 *
 * @returns {Promise<{mode:string, mission_id?:string}>}
 *   sans_objet | deja_programmee | payee | paiement_refuse | echec
 */
export async function programmerOccurrenceSuivante(missionId, supabaseUrl, headers) {
  const lr = await fetch(
    `${supabaseUrl}/rest/v1/missions?id=eq.${missionId}`
    + "&select=id,client_id,prestataire_id,sector,metier,titre,date,hours,heure_debut,adresse,ville,description,tarif_horaire,recurrence,stripe_payment_intent,status,retractation_renonciation_at,retractation_version&limit=1",
    { headers }
  );
  const lignes = await lr.json().catch(() => null);
  const m = Array.isArray(lignes) ? lignes[0] : null;
  if (!lr.ok || !m) {
    console.error(`[serie] prestation ${missionId} illisible (${lr.status}) — semaine suivante NON programmée.`);
    return { mode: "echec" };
  }
  if (!m.recurrence) return { mode: "sans_objet" };
  if (!m.prestataire_id || !m.stripe_payment_intent) {
    console.error(`[serie] ${missionId} : ni prestataire ni paiement — la série ne peut pas continuer.`);
    return { mode: "echec" };
  }

  const dr = await fetch(`${supabaseUrl}/rest/v1/missions?parent_mission_id=eq.${missionId}&select=id&limit=1`, { headers });
  const deja = await dr.json().catch(() => null);
  if (!dr.ok || !Array.isArray(deja)) {
    console.error(`[serie] ${missionId} : occurrence suivante non vérifiable (${dr.status}) — rien n'est créé.`);
    return { mode: "echec" };
  }
  if (deja.length) return { mode: "deja_programmee", mission_id: deja[0].id };

  const date = dateSuivante(m.date, m.recurrence);
  const frais = await lireFraisService(supabaseUrl, headers);
  const montant = montantOccurrence(m.tarif_horaire, m.hours, frais);
  if (!date || !montant) {
    console.error(`[serie] ${missionId} : date (${m.date}, ${m.recurrence}) ou tarif (${m.tarif_horaire} × ${m.hours}) illisible.`);
    return { mode: "echec" };
  }

  // 1. L'occurrence, en attente de paiement : aucun prestataire n'y est encore
  //    rattaché, elle n'apparaît donc dans aucune liste de demandes.
  const nouvelleId = crypto.randomUUID();
  const ir = await fetch(`${supabaseUrl}/rest/v1/missions`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      id: nouvelleId, client_id: m.client_id, prestataire_id: null,
      sector: m.sector, metier: m.metier || null, titre: m.titre || null,
      date, hours: m.hours, heure_debut: m.heure_debut || null,
      adresse: m.adresse || null, ville: m.ville || null, description: m.description || null,
      tarif_horaire: m.tarif_horaire, montant_total: montant,
      recurrence: m.recurrence, parent_mission_id: m.id,
      status: "pending_acceptance",
      // Renonciation au délai de rétractation (art. L221-25 du Code de la
      // consommation) : recueillie à la réservation de la série, sa case et l'accord
      // de série cochés ensemble. L'accord de série la demande EXPRESSÉMENT pour
      // chaque prestation suivante ; elle est donc reportée, avec la date et la
      // version du texte réellement acceptés — jamais présumée si la première
      // semaine n'en portait pas.
      ...(m.retractation_renonciation_at ? {
        retractation_renonciation_at: m.retractation_renonciation_at,
        retractation_version: m.retractation_version || null,
      } : {}),
    }),
  });
  const cree = await ir.json().catch(() => null);
  if (!ir.ok || !Array.isArray(cree) || !cree.length) {
    console.error(`[serie] ${missionId} : semaine suivante NON créée (${ir.status}) ${JSON.stringify(cree || {}).slice(0, 200)}`);
    return { mode: "echec" };
  }

  // 2. Le paiement de CETTE semaine, sur la carte de la première.
  const cle = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  let pi = null;
  let refus = null;
  // Issue inconnue : le prélèvement a PEUT-ÊTRE eu lieu (coupure réseau après
  // l'envoi). On ne dit alors surtout pas au client « rien n'a été débité ».
  let incertain = false;
  let envoye = false;
  try {
    if (!cle) throw new Error("STRIPE_SECRET_KEY absente");
    const sh = { Authorization: `Bearer ${cle}` };
    const pr = await fetch(`https://api.stripe.com/v1/payment_intents/${m.stripe_payment_intent}`, { headers: sh });
    const parent = await pr.json();
    const carte = typeof parent?.payment_method === "string" ? parent.payment_method : parent?.payment_method?.id;
    const client = typeof parent?.customer === "string" ? parent.customer : parent?.customer?.id;
    if (!pr.ok || !carte || !client) {
      refus = "carte non enregistrée";
    } else {
      // Clé d'idempotence FIXE pour la semaine qui suit CETTE prestation : un seul
      // prélèvement quoi qu'il arrive. Elle portait l'identifiant de la nouvelle
      // ligne, tiré au hasard à chaque appel : deux validations simultanées
      // créaient deux semaines et débitaient la carte deux fois (relecture du
      // 29/09/2026). Un second appel concurrent reçoit désormais une erreur
      // d'idempotence de Stripe, traitée plus bas comme « déjà programmée ».
      const creer = () => fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: { ...sh, "Idempotency-Key": `serie-suivante-${m.id}` },
        body: new URLSearchParams({
          amount: String(Math.round(montant * 100)),
          currency: "eur",
          customer: client,
          payment_method: carte,
          "payment_method_types[]": "card",
          off_session: "true",
          confirm: "true",
          "metadata[mission]": nouvelleId,
          "metadata[client]": m.client_id,
          "metadata[prestataire]": m.prestataire_id,
          "metadata[type]": "serie",
          "metadata[serie_precedente]": m.id,
          description: `${m.metier || "Prestation"} — ${date} (série ${m.recurrence})`,
        }),
      });
      // Une coupure réseau APRÈS l'envoi laissait croire à un refus : la semaine
      // était annulée et le client lisait « rien n'a été débité » alors que la
      // carte l'était peut-être. La même requête, avec la même clé, est rejouée
      // une fois : Stripe renvoie alors le résultat du premier envoi.
      let cr;
      let rejoue = false;
      envoye = true;
      try { cr = await creer(); }
      catch (e) {
        console.error(`[serie] ${nouvelleId} : réponse de Stripe perdue (${e.message}) — requête rejouée.`);
        rejoue = true;
        cr = await creer();
      }
      let cj = await cr.json();
      // Rejouée, la requête peut trouver la PREMIÈRE encore en cours chez Stripe :
      // même clé, mêmes paramètres, réponse 409 « idempotency_error ». Ce n'est
      // alors pas « une autre semaine déjà programmée » — c'est notre propre
      // prélèvement, peut-être réussi. Le prendre pour un doublon supprimait la
      // semaine d'un client débité (relecture du 30/09/2026). On attend, on
      // redemande ; si c'est encore en cours, l'issue est inconnue.
      if (rejoue && cj?.error?.type === "idempotency_error") {
        await new Promise(r => setTimeout(r, 3000));
        cj = await (await creer()).json();
        if (cj?.error?.type === "idempotency_error") throw new Error("prélèvement encore en cours chez Stripe");
      }
      if (cj?.status === "succeeded") pi = cj.id;
      else if (cj?.error?.type === "idempotency_error") {
        // Un autre appel programme déjà cette semaine : la ligne créée ici est
        // retirée sans rien dire au client.
        const retrait = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${nouvelleId}&stripe_payment_intent=is.null`, {
          method: "DELETE", headers: { ...headers, "Prefer": "return=minimal" },
        }).catch(() => null);
        if (!retrait?.ok) console.error(`[serie] ${nouvelleId} : doublon non retiré (${retrait?.status}) — à supprimer à la main.`);
        return { mode: "deja_programmee" };
      }
      else refus = cj?.error?.decline_code || cj?.error?.code || cj?.status || `HTTP ${cr.status}`;
    }
  } catch (e) {
    refus = e.message;
    // Incertain seulement si la demande de prélèvement est partie : une erreur
    // AVANT (clé absente, carte d'origine illisible) ne débite rien.
    incertain = envoye;
  }

  if (!pi && incertain) {
    // Deux échecs réseau de suite : on ignore si la carte a été débitée. Rien
    // n'est annoncé au client, la semaine reste en attente, et l'équipe doit
    // vérifier dans Stripe (métadonnée mission = nouvelleId).
    console.error(`[serie] ⚠️ ${missionId} → ${nouvelleId} : issue du prélèvement INCONNUE (${refus}). `
      + "Vérifier dans Stripe avant toute action ; la semaine reste en attente.");
    // Un journal que personne ne lit ne protège personne : l'équipe est prévenue
    // par courriel. La ligne, elle, n'est plus annulée par cron-abandon (filtre
    // `parent_mission_id=is.null`) : si la carte a été débitée, elle est la
    // seule trace de ce que le client a payé.
    const admin = process.env.ADMIN_EMAIL; // espaces significatifs : pas de nettoyage (CLAUDE.md 1.4)
    if (admin) {
      const parti = await sendEmail({
        to: admin,
        subject: `⚠️ Série hebdomadaire : prélèvement à vérifier dans Stripe`,
        html: `<p>Le prélèvement de la semaine du ${esc(dateFr(date))} (${esc(euros(montant))}) n'a pas pu être confirmé : `
          + `deux coupures réseau avec Stripe. On ignore si la carte du client a été débitée.</p>`
          + `<p>Dans Stripe, cherchez un paiement portant la métadonnée <strong>mission = ${esc(nouvelleId)}</strong>. `
          + `S'il existe, la semaine doit être affectée ; sinon, elle peut être annulée.</p>`
          + `<p>Prestation d'origine : ${esc(missionId)}.</p>`,
      });
      if (parti !== true) console.error(`[serie] ${nouvelleId} : alerte « prélèvement incertain » NON envoyée.`);
    } else {
      console.error(`[serie] ${nouvelleId} : ADMIN_EMAIL absente — alerte « prélèvement incertain » non envoyée.`);
    }
    return { mode: "echec", mission_id: nouvelleId };
  }

  if (!pi) {
    // Rien n'est prélevé : l'occurrence est annulée, la série s'arrête, et le
    // client sait pourquoi et comment la reprendre.
    console.error(`[serie] ${missionId} → ${nouvelleId} : paiement refusé (${refus}) — série interrompue.`);
    const ar = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${nouvelleId}`, {
      method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ status: "cancelled", recurrence: null }),
    });
    if (!ar.ok) console.error(`[serie] ${nouvelleId} : annulation NON enregistrée (${ar.status}).`);
    await notifier({
      user_id: m.client_id, type: "mission", ref_id: nouvelleId,
      title: "Série hebdomadaire interrompue",
      body: `Le paiement de votre prestation du ${dateFr(date)} (${euros(montant)}) n'a pas pu être effectué sur votre carte enregistrée. `
        + "Rien n'a été débité et la série est arrêtée. Réservez à nouveau pour la reprendre.",
    }, supabaseUrl, headers).catch(e => console.error("[serie] notification client échouée :", e.message));
    return { mode: "paiement_refuse", mission_id: nouvelleId };
  }

  // 3. Payée : proposée au même prestataire, avec le délai de réponse ordinaire.
  const echeance = new Date(Date.now() + delaiReponseMinutes({ ...m, date, montant_total: montant }, frais) * 60000).toISOString();
  const ur = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${nouvelleId}&status=eq.pending_acceptance`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({ prestataire_id: m.prestataire_id, stripe_payment_intent: pi, acceptance_deadline: echeance }),
  });
  const maj = await ur.json().catch(() => null);
  if (!ur.ok || !Array.isArray(maj) || !maj.length) {
    // L'argent est encaissé : l'échec est bruyant, et à reprendre à la main.
    console.error(`[serie] ${nouvelleId} : PAYÉE (${pi}) mais NON affectée (${ur.status}) — à reprendre à la main.`);
    return { mode: "echec", mission_id: nouvelleId };
  }
  await prevenirNouvelleDemande(nouvelleId, supabaseUrl, headers);
  await notifier({
    user_id: m.client_id, type: "mission", ref_id: nouvelleId,
    title: "🔄 Prochaine prestation réservée",
    body: `${m.metier || "Prestation"} le ${dateFr(date)}${m.heure_debut ? ` à ${String(m.heure_debut).slice(0, 5)}` : ""} : `
      + `${euros(montant)} débités sur votre carte. Votre prestataire doit encore confirmer. `
      + "Vous pouvez arrêter la série à tout moment depuis vos prestations.",
  }, supabaseUrl, headers).catch(e => console.error("[serie] notification client échouée :", e.message));
  return { mode: "payee", mission_id: nouvelleId };
}
