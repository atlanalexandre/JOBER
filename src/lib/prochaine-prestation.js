// Calculs de date de l'espace prestataire, côté navigateur.

// Instant du début prévu, tel que le navigateur le voit.
//
// `debutPrestationMs` n'est PAS utilisable ici : elle interprète une date naïve
// dans le fuseau du runtime puis applique le décalage français. C'est juste sur
// Vercel, qui tourne en UTC, et faux dans un navigateur déjà à l'heure de Paris.
// Chaque côté calcule donc l'instant à sa façon ; seule la RÈGLE des fenêtres
// est partagée.
export function debutLocalMs(m) {
  if (!m?.date) return null;
  const heure = String(m.heure_debut || "00:00").slice(0, 5);
  const t = new Date(`${m.date}T${heure}`).getTime();
  return Number.isNaN(t) ? null : t;
}

// La prochaine prestation acceptée, pour le résumé de l'accueil.
export function prochainePrestation(assigned, maintenant = Date.now()) {
  const debutJour = new Date(maintenant); debutJour.setHours(0, 0, 0, 0);
  const lignes = (assigned || [])
    .filter(m => m.status !== "cancelled")
    .map(m => {
      const t = debutLocalMs(m);
      const fin = m.date_fin ? new Date(`${String(m.date_fin).slice(0, 10)}T23:59:59`).getTime() : null;
      // Une série sur plusieurs jours déjà commencée est « en cours » jusqu'à
      // son dernier jour : on la range à aujourd'hui, pas à son premier jour.
      const enCours = t != null && fin != null && t < maintenant && fin >= maintenant;
      return { m, t, fin, enCours, cle: enCours ? debutJour.getTime() : (t ?? Infinity) };
    })
    // Une prestation commencée reste « la prochaine » 12 h après son début.
    .filter(x => x.t == null || x.enCours || x.t >= maintenant - 12 * 3600 * 1000)
    .sort((a, b) => a.cle - b.cle);
  return { prochaine: lignes[0] || null, nb: lignes.length };
}
