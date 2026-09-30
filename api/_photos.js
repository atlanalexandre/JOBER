// ═══════════════════════════════════════════════════════════════════════════
// La photo montrée au client : celle qu'ALANE a validée, et elle seule
// ═══════════════════════════════════════════════════════════════════════════
//
// Deux photos coexistaient (décision d'Alexandre du 30/09/2026 : « je garde
// que la photo qui est vérifiée ») :
//
//   • `profiles.avatar_url` — choisie et changée à volonté par le prestataire
//     depuis « Modifier mon profil ». Personne ne la contrôlait, et c'est elle
//     que le catalogue montrait ;
//   • le document `photo` — déposé dans le bucket privé `Documents`, comparé à
//     la pièce d'identité et validé depuis le back-office.
//
// Un client pouvait donc réserver sur une photo et voir quelqu'un d'autre à sa
// porte. Seule la seconde est désormais servie, par URL signée d'une heure. Un
// prestataire sans photo validée apparaît avec ses initiales.
//
// Ce n'est PAS la pièce d'identité, qui reste lisible du seul back-office.

const DUREE_URL_S = 3600;
const LOT = 100;

/**
 * Photos validées des prestataires demandés, en URL signée.
 * @returns {Promise<Map<string, string>>} prestataire_id → URL. Un échec est
 *   journalisé et laisse les prestataires concernés sans photo : une photo
 *   manquante ne doit pas faire échouer la page qui l'affiche.
 */
export async function photosVerifiees(ids, SUPABASE_URL, headers) {
  const carte = new Map();
  const uniques = [...new Set((ids || []).filter(Boolean))];
  for (let i = 0; i < uniques.length; i += LOT) {
    const lot = uniques.slice(i, i + LOT);
    try {
      const dr = await fetch(
        `${SUPABASE_URL}/rest/v1/documents?prestataire_id=in.(${lot.join(",")})`
        + `&type=eq.photo&verified=eq.true&select=prestataire_id,storage_path`,
        { headers }
      );
      const lignes = await dr.json().catch(() => null);
      if (!dr.ok || !Array.isArray(lignes)) {
        console.error(`[photos] photos validées illisibles (${dr.status}) — ${lot.length} prestataire(s) sans photo.`);
        continue;
      }
      const avecChemin = lignes.filter(l => l.storage_path);
      if (avecChemin.length === 0) continue;
      const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/Documents`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: DUREE_URL_S, paths: avecChemin.map(l => l.storage_path) }),
      });
      const signees = await sr.json().catch(() => null);
      if (!sr.ok || !Array.isArray(signees)) {
        console.error(`[photos] URL signées refusées (${sr.status}) — ${avecChemin.length} photo(s) non affichée(s).`);
        continue;
      }
      const parChemin = new Map(signees.filter(s => s?.signedURL).map(s => [s.path, s.signedURL]));
      for (const l of avecChemin) {
        const u = parChemin.get(l.storage_path);
        if (u) carte.set(l.prestataire_id, `${SUPABASE_URL}/storage/v1${u}`);
        else console.error(`[photos] URL signée absente pour ${l.storage_path}`);
      }
    } catch (e) {
      console.error(`[photos] photos validées indisponibles pour ${lot.length} prestataire(s) :`, e.message);
    }
  }
  return carte;
}
