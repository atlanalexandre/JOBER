// Tout ce qu'un compte ne voit qu'une seule fois, dans sa vie de navigateur.
//
// Ces clés vivent dans le `localStorage` de l'application — donc sur
// www.alane.fr. Le back-office, lui, est servi sur admin.alane.fr : c'est une
// AUTRE origine, avec son propre stockage. Le bouton « réinitialiser le
// tutoriel » du back-office effaçait donc consciencieusement des clés qui
// n'existaient pas, et le tutoriel ne repartait jamais.
//
// D'où ce fichier partagé : le back-office ne touche plus à rien, il envoie le
// navigateur sur l'application avec `?tutoriel=reset`, et c'est l'application
// qui efface ses propres clés, là où elles sont réellement écrites.
export const CLES_PREMIERE_VISITE = [
  "alane_onboarded",                    // le tutoriel lui-même (suffixé par l'id du compte)
  "alane_presta_checklist_dismissed",   // checklist « complétez votre profil »
  "alane_pwa_banner",                   // bannière d'installation
  "alane_notif_asked",                  // demande d'autorisation des notifications
  // Le guide des onglets du tableau de bord prestataire. Il manquait à cette
  // liste : le bouton « Réinitialiser le tutoriel » rejouait l'accueil du
  // tutoriel mais laissait le guide marqué comme déjà vu, et il n'existait
  // aucun moyen de le revoir. C'est pourtant le même genre de repère.
  "alane_presta_tour_done",
];

// Renvoie le nombre de clés effacées, ou -1 si le stockage est inaccessible
// (navigation privée). L'appelant décide quoi en dire.
export function effacerPremiereVisite() {
  try {
    const cibles = Object.keys(localStorage)
      .filter(k => CLES_PREMIERE_VISITE.some(prefixe => k.startsWith(prefixe)));
    cibles.forEach(k => localStorage.removeItem(k));
    return cibles.length;
  } catch (e) {
    console.error("[tutoriel] stockage local inaccessible :", e.message);
    return -1;
  }
}

// L'origine de l'APPLICATION, vue depuis n'importe quelle page du site.
//
// Depuis admin.alane.fr, « / » renvoie au back-office, pas à l'accueil : le
// bouton semblait ne rien faire alors qu'il rechargeait simplement le
// back-office. En local (localhost, preview Vercel), l'origine courante est la
// bonne — il n'y a qu'un seul hôte.
export function origineApp() {
  const { protocol, host } = window.location;
  if (/^admin\./i.test(host)) return `${protocol}//${host.replace(/^admin\./i, "www.")}`;
  return `${protocol}//${host}`;
}
