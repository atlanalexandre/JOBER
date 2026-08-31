import { verifyUser } from "./_auth.js";

// ═══════════════════════════════════════════════════════════════════════════
// Reconstruire une ligne `profiles` manquante
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// L'inscription se fait en DEUX temps depuis le navigateur : `auth.signUp()`
// crée le compte, puis un `upsert` crée la ligne `profiles`. Entre les deux,
// rien ne garantit que le second aboutisse — et quand il échoue, le compte
// d'authentification existe DÉJÀ.
//
// L'utilisateur voyait alors « Erreur création profil. Contactez le support »,
// recommençait, et se heurtait à « Un compte existe déjà avec cet email ».
// Impasse complète : il ne peut ni s'inscrire, ni se connecter — la connexion
// répond « Profil introuvable ». Constaté le 31/08/2026 sur un vrai candidat
// prestataire, qui a abandonné.
//
// La cause première la plus probable est l'absence de session immédiate à la
// sortie de `signUp` : sans jeton, l'`upsert` part en rôle anonyme et la RLS le
// refuse. Mais la cause importe moins que la conséquence — un compte à
// moitié créé ne doit jamais rester un cul-de-sac.
//
// CE QUE FAIT CETTE FONCTION
//
// Appelée avec un jeton VALIDE, elle recrée la ligne manquante à partir des
// données d'inscription conservées dans `user_metadata`. Elle est idempotente :
// si le profil existe, elle le renvoie sans rien modifier.
//
// CE QU'ELLE NE FAIT PAS
//
// Elle n'accorde aucun droit. Le profil naît `status: "pending"`, plan
// `free`, sans accès aux prestations — exactement comme à l'inscription. Elle
// ne touche jamais à un profil existant : pas de mise à jour, pas de
// changement de rôle. Réparer, ce n'est pas requalifier.
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  // L'identité vient du jeton vérifié, jamais du corps de la requête : sans
  // cela, n'importe qui pourrait se fabriquer un profil au nom d'un autre.
  const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!caller?.id) return res.status(401).json({ error: "Non authentifié" });

  const headers = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const dejaLa = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=id,role,status&limit=1`,
      { headers }
    );
    const lignes = dejaLa.ok ? await dejaLa.json().catch(() => []) : null;
    if (lignes === null) {
      console.error(`[reparer-profil] lecture impossible pour ${caller.id} :`, dejaLa.status);
      return res.status(502).json({ error: "Profil illisible — réessayez dans un instant." });
    }
    if (Array.isArray(lignes) && lignes.length > 0) {
      return res.status(200).json({ profil: lignes[0], repare: false });
    }

    // Les données d'inscription survivent dans `user_metadata` : c'est là que
    // le navigateur les a écrites au moment du `signUp`, avant l'échec.
    const meta = caller.user_metadata || {};
    const role = meta.role === "prestataire" ? "prestataire" : "client";

    const profil = {
      id: caller.id,
      role,
      prenom: (meta.prenom || "").trim() || null,
      nom: (meta.nom || "").trim() || null,
      // Un profil réparé naît exactement comme un profil normal : en attente.
      status: "pending",
      plan_abonnement: "free",
      adresse:     (meta.adresse || "").trim() || null,
      code_postal: (meta.code_postal || "").trim() || null,
      ville:       (meta.ville || "").trim() || null,
      accepte_communications: meta.accepte_communications === true,
      accepte_communications_at: meta.accepte_communications === true ? new Date().toISOString() : null,
    };
    if (meta.societe_nom) profil.societe_nom = String(meta.societe_nom).trim();

    const creation = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify(profil),
    });
    const cree = await creation.json().catch(() => null);
    if (!creation.ok) {
      // Une insertion concurrente a pu gagner la course : ce n'est pas un échec.
      if (creation.status === 409) {
        console.log(`[reparer-profil] ${caller.id} : profil déjà créé entre-temps.`);
        return res.status(200).json({ profil: { id: caller.id, role }, repare: false });
      }
      console.error(`[reparer-profil] création refusée pour ${caller.id} :`, creation.status, JSON.stringify(cree).slice(0, 300));
      return res.status(502).json({ error: "Le profil n'a pas pu être créé. Écrivez à direction@alane.fr." });
    }

    console.log(`[reparer-profil] profil ${role} reconstruit pour ${caller.id} — inscription interrompue rattrapée.`);
    return res.status(200).json({ profil: Array.isArray(cree) ? cree[0] : cree, repare: true });
  } catch (e) {
    console.error("[reparer-profil] erreur inattendue :", e.message);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
