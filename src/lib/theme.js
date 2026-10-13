// Thème clair (14/10/2026).
//
// L'option des Réglages ne marchait pas, pour deux raisons :
//   1. l'inversion des couleurs était posée sur <body> ET sur #root : appliquée
//      deux fois, elle s'annulait, et l'écran restait sombre ;
//   2. le choix n'était relu nulle part au démarrage : rouvrir l'application
//      la remettait en sombre, l'interrupteur restant sur « clair ».
// L'inversion vit désormais sur <html> seul (src/index.css) — le seul élément
// où un filtre ne décroche pas les éléments « fixes », comme la barre du bas.

export const CLE_THEME = "alane_light_mode";

export function themeClairEnregistre() {
  try { return localStorage.getItem(CLE_THEME) === "1"; }
  catch { return false; /* stockage indisponible (navigation privée) : thème sombre par défaut */ }
}

export function appliquerTheme(clair, racine = document.documentElement) {
  racine.setAttribute("data-alane-theme", clair ? "light" : "dark");
}

export function choisirTheme(clair) {
  try { localStorage.setItem(CLE_THEME, clair ? "1" : "0"); }
  catch { /* stockage indisponible : le choix vaut pour cette visite seulement */ }
  appliquerTheme(clair);
}
