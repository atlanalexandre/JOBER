import { verifyUser } from "./_auth.js";
import { creerProfilSiAbsent } from "./_profil.js";

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
    // `creerProfilSiAbsent` porte la définition d'un profil neuf, partagée avec
    // le balayage automatique : une seule écriture de « ce qu'est un profil qui
    // vient de naître », pour qu'elle ne diverge jamais.
    const { cree, motif } = await creerProfilSiAbsent(caller, SUPABASE_URL, headers);

    if (!cree && motif && !/déjà/.test(motif)) {
      console.error(`[reparer-profil] ${caller.id} : ${motif}`);
      return res.status(502).json({ error: "Le profil n'a pas pu être créé. Écrivez à direction@alane.fr." });
    }
    if (cree) {
      console.log(`[reparer-profil] profil reconstruit pour ${caller.id} — inscription interrompue rattrapée.`);
    }

    const relecture = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=id,role,status&limit=1`,
      { headers }
    );
    const lignes = relecture.ok ? await relecture.json().catch(() => []) : [];
    const profil = Array.isArray(lignes) && lignes[0] ? lignes[0] : null;
    if (!profil) {
      console.error(`[reparer-profil] ${caller.id} : profil introuvable après création.`);
      return res.status(502).json({ error: "Profil illisible — réessayez dans un instant." });
    }
    return res.status(200).json({ profil, repare: cree });
  } catch (e) {
    console.error("[reparer-profil] erreur inattendue :", e.message);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
