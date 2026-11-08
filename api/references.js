// ═══════════════════════════════════════════════════════════════════════════
// /api/references — références d'expérience confirmées par e-mail (09/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
//   action "ajouter"  (prestataire connecté) — enregistre la référence, écrit
//                     à la personne citée ;
//   action "lire"     (public, par jeton)    — ce que la page de réponse montre ;
//   action "repondre" (public, par jeton)    — la réponse, une seule fois.
//
// Les règles sont dans api/_references.js. La table, `references_experience`,
// n'est écrite qu'ici, en service role (migration 2026-11-09).
// ═══════════════════════════════════════════════════════════════════════════

import { verifyUser, refuserCompteBloque } from "./_auth.js";
import { sendEmail } from "./_email.js";
import { appUrl } from "./_url.js";
import { metiersDeclares } from "./_qualifications.js";
import {
  MAX_REFERENCES, validerReference, entrepriseSirene, alerteDe, genererJeton, empreinte,
  courrielReference, validerReponse, jetonExpire,
} from "./_references.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration serveur manquante" });
  const headers = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
  const table = `${SUPABASE_URL}/rest/v1/references_experience`;
  const { action } = req.body || {};

  // ── La page publique de réponse ────────────────────────────────────────────
  if (action === "lire" || action === "repondre") {
    const jeton = String(req.body?.jeton || "");
    if (jeton.length < 20 || jeton.length > 100) return res.status(400).json({ error: "Lien invalide." });
    const hash = empreinte(jeton);
    const lr = await fetch(`${table}?jeton_hash=eq.${hash}&select=id,prestataire_id,entreprise,metier,annee_debut,annee_fin,statut,created_at`, { headers });
    const lignes = await lr.json().catch(() => null);
    if (!lr.ok || !Array.isArray(lignes)) {
      console.error(`[references] lecture par jeton refusée (${lr.status}) — migration 2026-11-09_references_experience.sql passée ?`);
      return res.status(503).json({ error: "Service momentanément indisponible. Réessayez dans un instant." });
    }
    const ref = lignes[0];
    if (!ref) return res.status(404).json({ error: "Ce lien n'est pas valable." });
    if (ref.statut !== "en_attente") return res.status(410).json({ error: "Merci : une réponse a déjà été donnée pour cette référence." });
    if (jetonExpire(ref.created_at)) {
      const er = await fetch(`${table}?id=eq.${ref.id}&statut=eq.en_attente`, { method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" }, body: JSON.stringify({ statut: "expiree" }) });
      if (!er.ok) console.error(`[references] référence ${ref.id} non marquée expirée (${er.status})`);
      return res.status(410).json({ error: "Ce lien a expiré." });
    }

    if (action === "lire") {
      const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${ref.prestataire_id}`, { headers });
      const u = await ur.json().catch(() => ({}));
      if (!ur.ok) console.error(`[references] compte ${ref.prestataire_id} illisible (${ur.status}) — prénom non affiché`);
      const meta = u?.user_metadata || {};
      return res.status(200).json({
        prenom: String(meta.prenom || "").trim() || null,
        initiale: String(meta.nom || "").trim().charAt(0).toUpperCase() || null,
        entreprise: ref.entreprise, metier: ref.metier, annee_debut: ref.annee_debut, annee_fin: ref.annee_fin,
      });
    }

    const v = validerReponse(req.body?.reponse);
    if (!v.ok) return res.status(400).json({ error: v.erreur });
    // Une seule réponse : la condition sur le statut rend l'écriture atomique.
    const wr = await fetch(`${table}?id=eq.${ref.id}&statut=eq.en_attente`, {
      method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({ statut: v.valeur.a_travaille ? "confirmee" : "refusee", reponse: v.valeur, repondu_at: new Date().toISOString() }),
    });
    const ecrit = await wr.json().catch(() => null);
    if (!wr.ok) {
      console.error(`[references] réponse à ${ref.id} non enregistrée (${wr.status})`);
      return res.status(502).json({ error: "Votre réponse n'a pas pu être enregistrée. Réessayez dans un instant." });
    }
    if (!Array.isArray(ecrit) || ecrit.length === 0) return res.status(410).json({ error: "Merci : une réponse a déjà été donnée pour cette référence." });
    return res.status(200).json({ ok: true });
  }

  // ── Le prestataire ajoute une référence ────────────────────────────────────
  if (action !== "ajouter") return res.status(400).json({ error: "Action inconnue" });
  const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!caller) return res.status(401).json({ error: "Session expirée — reconnectez-vous." });
  if (await refuserCompteBloque(res, caller, SUPABASE_URL, SERVICE_ROLE_KEY)) return;
  // Le rôle se lit sur la fiche, que seul le serveur écrit : user_metadata, le
  // titulaire du compte peut le modifier lui-même.
  const fr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=role`, { headers });
  const fiche = await fr.json().catch(() => null);
  if (!fr.ok || !Array.isArray(fiche)) {
    console.error(`[references] fiche de ${caller.id} illisible (${fr.status})`);
    return res.status(503).json({ error: "Vérification du compte impossible. Réessayez dans un instant." });
  }
  if (fiche[0]?.role !== "prestataire") return res.status(403).json({ error: "Réservé aux prestataires." });

  const v = validerReference(req.body, { metiersDeclares: metiersDeclares(caller.user_metadata), emailPrestataire: caller.email });
  if (!v.ok) return res.status(400).json({ error: v.erreur });
  const ref = v.valeur;

  // Plafond, doublon, et contact partagé avec d'autres prestataires.
  const er = await fetch(`${table}?prestataire_id=eq.${caller.id}&select=contact_email`, { headers });
  const existantes = await er.json().catch(() => null);
  if (!er.ok || !Array.isArray(existantes)) {
    console.error(`[references] références de ${caller.id} illisibles (${er.status}) — migration 2026-11-09_references_experience.sql passée ?`);
    return res.status(503).json({ error: "Les références ne sont pas encore disponibles. Réessayez plus tard." });
  }
  if (existantes.length >= MAX_REFERENCES) return res.status(409).json({ error: `${MAX_REFERENCES} références au plus.` });
  if (existantes.some(x => x.contact_email === ref.contact_email)) return res.status(409).json({ error: "Cette personne est déjà l'une de vos références." });
  const pr = await fetch(`${table}?contact_email=eq.${encodeURIComponent(ref.contact_email)}&prestataire_id=neq.${caller.id}&select=prestataire_id`, { headers });
  const partages = await pr.json().catch(() => null);
  if (!pr.ok || !Array.isArray(partages)) {
    console.error(`[references] contrôle du contact partagé impossible (${pr.status})`);
    return res.status(503).json({ error: "Vérification impossible pour le moment. Réessayez dans un instant." });
  }

  let entreprise;
  try { entreprise = await entrepriseSirene(ref.siret); }
  catch (e) {
    console.error("[references] SIRENE :", e.message);
    return res.status(503).json({ error: "Le registre des entreprises ne répond pas. Réessayez dans un instant." });
  }
  if (!entreprise) return res.status(400).json({ error: "Ce SIRET est introuvable dans le registre des entreprises." });
  if (!entreprise.actif) return res.status(400).json({ error: "Cette entreprise est fermée d'après le registre : choisissez une référence dans une entreprise en activité." });

  const { jeton, hash } = genererJeton();
  const ir = await fetch(table, {
    method: "POST", headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      prestataire_id: caller.id, ...ref, entreprise: entreprise.nom, jeton_hash: hash,
      alerte: alerteDe({ contactEmail: ref.contact_email, autresPrestataires: new Set(partages.map(p => p.prestataire_id)).size }),
    }),
  });
  const inseree = await ir.json().catch(() => null);
  if (!ir.ok || !Array.isArray(inseree) || !inseree[0]) {
    console.error(`[references] référence de ${caller.id} non enregistrée (${ir.status})`);
    return res.status(502).json({ error: "La référence n'a pas pu être enregistrée. Réessayez." });
  }

  const meta = caller.user_metadata || {};
  const courriel = courrielReference({
    prenom: String(meta.prenom || "").trim(), initiale: String(meta.nom || "").trim().charAt(0).toUpperCase(),
    entreprise: entreprise.nom, metier: ref.metier, debut: ref.annee_debut, fin: ref.annee_fin,
    lien: `${appUrl()}/reference?t=${jeton}`,
  });
  const envoye = await sendEmail({ to: ref.contact_email, subject: courriel.subject, html: courriel.html });
  if (envoye !== true) {
    // Le jeton n'est conservé que par son empreinte : sans l'e-mail, personne ne
    // pourra jamais répondre. La ligne est retirée, le prestataire réessaie.
    console.error(`[references] e-mail à la référence ${inseree[0].id} NON envoyé (${envoye}) — ligne retirée`);
    const dr = await fetch(`${table}?id=eq.${inseree[0].id}`, { method: "DELETE", headers });
    if (!dr.ok) console.error(`[references] référence ${inseree[0].id} sans e-mail NON retirée (${dr.status})`);
    return res.status(502).json({ error: "L'e-mail à votre référence n'a pas pu partir. Vérifiez l'adresse et réessayez." });
  }
  const mr = await fetch(`${table}?id=eq.${inseree[0].id}`, { method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" }, body: JSON.stringify({ envoyee_at: new Date().toISOString() }) });
  if (!mr.ok) console.error(`[references] date d'envoi de ${inseree[0].id} non enregistrée (${mr.status})`);
  return res.status(200).json({ ok: true, entreprise: entreprise.nom });
}
