// ═══════════════════════════════════════════════════════════════════════════
// Modération : les services à caractère sexuel (02/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Question d'Alexandre : « une escorte girl peut-elle s'inscrire sur ALANE ? »
// Aucun métier de ce type n'existe, mais un métier de couverture — modelage
// bien-être, hôtesse, aide à domicile — peut en servir. Une plateforme qui
// facilite la prostitution d'autrui et en tire une commission s'expose au
// délit de proxénétisme (code pénal, art. 225-5 et 225-6) dès lors qu'elle
// laisse faire. Il faut donc VOIR, et agir.
//
// CE QUE FAIT CE MODULE : il repère des mots sans ambiguïté dans les textes
// libres — messages, présentation et CV du prestataire, description d'une
// demande — et ouvre un ticket « [Modération] » au back-office. Il ne bloque
// RIEN et ne sanctionne personne : un faux positif (« harcèlement sexuel »
// dans un signalement, par exemple) ne doit jamais couper un échange légitime.
// La décision reste humaine, et le ticket la rend possible.
//
// AVANT D'AJOUTER UN MOT : vérifier qu'il ne figure pas dans un usage
// ordinaire d'un des 240 métiers. « Massage » seul, « finition », « rapport »
// ou « body » (le soin) crieraient tous les jours, et un contrôle qui crie
// tous les jours finit ignoré (CLAUDE.md §4bis).
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";

/** Minuscules, sans accent, ponctuation ramenée à des espaces. */
export function normaliser(texte) {
  return ` ${String(texte || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

// Chaque entrée : le libellé montré au back-office, et le motif sur le texte
// normalisé (encadré d'espaces). Les mots isolés sont bornés aux deux bouts.
export const MOTS_SUSPECTS = [
  // « escort » seul, en anglais : « escorte » est un mot français ordinaire de
  // la sécurité (escorte de fonds, agent d'escorte) — relecture du 03/11/2026.
  ["escort", / escorts? /],
  ["escort girl", / escort ?girls? /],
  ["call girl", / call ?girls? /],
  ["prostitution", / prostitu/],
  ["érotique", / erotiques? /],
  ["naturiste", / naturistes? /],
  ["tantrique", / tantr(a|ique|iques) /],
  ["nuru", / nuru /],
  ["body-body", / body (a |to )?body /],
  ["happy ending", / happy end(ing)? /],
  ["fin heureuse", / fin(ition)? heureuse /],
  ["massage sensuel", / massages? (sensuels?|intimes?|prostatiques?) /],
  ["plan cul", / plans? culs? /],
  ["sans tabou", / sans tabous? /],
  ["relation tarifée", / (relations?|rapports?) tarife(e|es|s)? /],
  ["acte sexuel", / (actes?|services?|prestations?|rapports?) sexuel(le|les|s)? /],
  ["domina", / domina(trice)? /],
];

/** Les mots suspects trouvés dans le texte, sans doublon. [] s'il n'y en a aucun. */
export function motsSuspects(texte) {
  const t = normaliser(texte);
  if (t.trim() === "") return [];
  return MOTS_SUSPECTS.filter(([, motif]) => motif.test(t)).map(([libelle]) => libelle);
}

/** Empreinte courte d'un texte : un même contenu, une seule alerte. */
export const empreinte = (texte) => createHash("sha256").update(normaliser(texte)).digest("hex").slice(0, 8);

/**
 * Ouvre un ticket « [Modération] » au back-office, une seule fois par contenu.
 * Ne lève jamais : la modération ne doit pas faire échouer l'envoi d'un message.
 * @returns {Promise<"cree"|"deja"|"echec">}
 */
export async function signalerAuBackOffice({ supabaseUrl, headers, userId, origine, texte, mots }) {
  const sujet = `[Modération] ${origine} — compte ${userId} — ${empreinte(texte)}`;
  try {
    const dj = await fetch(`${supabaseUrl}/rest/v1/support_tickets?subject=eq.${encodeURIComponent(sujet)}&select=id&limit=1`, { headers });
    const deja = dj.ok ? await dj.json().catch(() => null) : null;
    if (!Array.isArray(deja)) throw new Error(`tickets illisibles (${dj.status})`);
    if (deja.length) return "deja";
    const extrait = String(texte).length > 600 ? `${String(texte).slice(0, 600)}…` : String(texte);
    const t = await fetch(`${supabaseUrl}/rest/v1/support_tickets`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=minimal" },
      // `user_id` reste VIDE : le compte concerné n'est pas l'auteur du ticket.
      // Rattaché à lui, le ticket lui aurait été répondu par « Répondre »
      // (repondre_ticket écrit à `user_id`), lui apprenant qu'il était repéré,
      // et la suppression de son compte l'aurait effacé — la trace avec
      // (relecture du 03/11/2026). Il est nommé dans le sujet et le message.
      body: JSON.stringify({ subject: sujet, user_id: null, status: "open",
        message: `Compte concerné : ${userId}\nMots repérés : ${mots.join(", ")}.\n\nTexte (${origine}) :\n${extrait}\n\n`
          + "À vérifier : une prestation à caractère sexuel est interdite. Rien n'a été bloqué automatiquement — "
          + "suspendre le compte depuis le back-office si le doute se confirme, ou fermer ce ticket s'il s'agit d'un faux positif." }),
    });
    if (!t.ok) throw new Error(`ticket refusé (${t.status})`);
    return "cree";
  } catch (e) {
    console.error(`[moderation] SIGNALEMENT NON CRÉÉ (${origine}, compte ${userId}, mots : ${mots.join(", ")}) :`, e.message);
    return "echec";
  }
}

/**
 * Le balayage quotidien : présentation et CV des prestataires, descriptions des
 * demandes des dernières 24 h. Fonction pure sur les données lues.
 * @returns {Array<{userId:string, origine:string, texte:string, mots:string[]}>}
 */
export function contenusSuspects({ comptes = [], profils = [], missions = [] }) {
  const trouves = [];
  const examiner = (userId, origine, texte) => {
    const mots = motsSuspects(texte);
    if (mots.length) trouves.push({ userId, origine, texte: String(texte), mots });
  };
  for (const u of comptes) {
    if (u?.user_metadata?.role !== "prestataire") continue;
    examiner(u.id, "Présentation du prestataire", u.user_metadata?.bio);
  }
  for (const p of profils) if (p?.cv) examiner(p.id, "CV du prestataire", typeof p.cv === "string" ? p.cv : JSON.stringify(p.cv));
  for (const m of missions) examiner(m.client_id, "Description d'une demande", [m.titre, m.description].filter(Boolean).join(" — "));
  return trouves;
}
