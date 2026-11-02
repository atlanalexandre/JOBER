// Les chiffres de « Invitez vos clients » (décision d'Alexandre du 02/11/2026).
// Dans un fichier à part, sans dépendance : l'écran du prestataire les affiche
// et le traitement serveur (`api/_invitation.js`) les applique. Une copie dans
// l'écran aurait fini par annoncer d'autres conditions que celles appliquées.

/** Prix minimal de la prestation, hors frais de service. */
export const MONTANT_MIN = 50;
/** Mois offerts au plus, par prestataire, sur douze mois glissants. */
export const PLAFOND_MOIS_PAR_AN = 6;
