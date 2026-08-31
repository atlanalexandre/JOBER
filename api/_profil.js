// ═══════════════════════════════════════════════════════════════════════════
// Ce qu'est un profil neuf — une seule définition
// ═══════════════════════════════════════════════════════════════════════════
//
// L'inscription se fait en deux temps : `auth.signUp()` crée le compte, puis un
// `upsert` crée la ligne `profiles`. Quand le second échoue, le compte existe
// sans profil — et son propriétaire ne peut alors ni se réinscrire (« un compte
// existe déjà »), ni se connecter (« profil introuvable »).
//
// Trois endroits doivent savoir reconstruire cette ligne : le rattrapage
// immédiat de l'inscription, la connexion, et le balayage automatique. Écrite
// trois fois, elle finirait par diverger — et c'est un profil qui n'accorde
// aucun droit aujourd'hui qui en accorderait un demain par recopie distraite.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Le profil correspondant à un compte, tel qu'il aurait dû être créé à
 * l'inscription. Rien n'est deviné : tout vient de `user_metadata`, où le
 * navigateur l'a écrit au moment du `signUp`.
 *
 * Le profil naît TOUJOURS `pending`, plan `free`, sans accès aux prestations —
 * exactement comme une inscription normale. Réparer, ce n'est pas requalifier.
 */
export function profilDepuisMetadonnees(user) {
  const meta = user?.user_metadata || {};
  const profil = {
    id: user?.id,
    role: meta.role === "prestataire" ? "prestataire" : "client",
    prenom: String(meta.prenom || "").trim() || null,
    nom: String(meta.nom || "").trim() || null,
    status: "pending",
    plan_abonnement: "free",
    adresse:     String(meta.adresse || "").trim() || null,
    code_postal: String(meta.code_postal || "").trim() || null,
    ville:       String(meta.ville || "").trim() || null,
    accepte_communications: meta.accepte_communications === true,
    accepte_communications_at: meta.accepte_communications === true ? new Date().toISOString() : null,
  };
  if (meta.societe_nom) profil.societe_nom = String(meta.societe_nom).trim();
  return profil;
}

/**
 * Le rôle a-t-il été réellement déclaré à l'inscription ?
 *
 * `profilDepuisMetadonnees` retombe sur « client » par défaut, ce qui convient
 * à une réparation demandée par le titulaire lui-même — il est devant son
 * écran, il verra tout de suite si c'est faux. Le balayage automatique, lui,
 * décide pour quelqu'un d'absent : il ne doit rien inventer, et signale plutôt
 * que de trancher.
 */
export function roleDeclare(user) {
  const r = user?.user_metadata?.role;
  return r === "prestataire" || r === "client" ? r : null;
}

/**
 * Crée la ligne si elle manque. Idempotent : ne modifie JAMAIS un profil
 * existant.
 *
 * @returns {Promise<{cree:boolean, motif?:string}>}
 */
export async function creerProfilSiAbsent(user, supabaseUrl, headers) {
  const id = user?.id;
  if (!id) return { cree: false, motif: "identifiant manquant" };

  const lecture = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id&limit=1`,
    { headers }
  );
  if (!lecture.ok) return { cree: false, motif: `lecture refusée (${lecture.status})` };
  const lignes = await lecture.json().catch(() => null);
  if (!Array.isArray(lignes)) return { cree: false, motif: "réponse illisible" };
  if (lignes.length > 0) return { cree: false, motif: "profil déjà présent" };

  const creation = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify(profilDepuisMetadonnees(user)),
  });
  if (creation.ok) return { cree: true };

  // Une insertion concurrente a pu gagner la course : ce n'est pas un échec.
  if (creation.status === 409) return { cree: false, motif: "profil créé entre-temps" };
  const detail = await creation.text().catch(() => "");
  return { cree: false, motif: `création refusée (${creation.status}) ${detail.slice(0, 200)}` };
}
