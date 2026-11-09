// ═══════════════════════════════════════════════════════════════════════════
// Faire défiler la page jusqu'à une section (09/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// `scrollIntoView` fait défiler TOUS les conteneurs ancêtres, y compris ceux
// en `overflow: hidden` — le cadre décoratif de l'accueil en est un, plus
// large que l'écran. Sur téléphone, la page se décalait : le texte collait au
// bord gauche, le haut d'un bloc disparaissait (constaté le 09/11/2026 en
// ajoutant les cases « client » et « indépendant »). On ne fait défiler que
// le vrai conteneur de défilement, verticalement.

/** Le premier ancêtre qui défile réellement (overflow-y auto ou scroll). */
function conteneurDefilant(el) {
  for (let c = el.parentElement; c; c = c.parentElement) {
    const oy = getComputedStyle(c).overflowY;
    if ((oy === "auto" || oy === "scroll") && c.scrollHeight > c.clientHeight) return c;
  }
  return null;
}

/** Amène la section `id` en haut de l'écran, à `marge` pixels près. */
export function defilerVers(id, marge = 16) {
  const el = document.getElementById(id);
  if (!el) return;
  const c = conteneurDefilant(el);
  if (c) {
    c.scrollTo({ top: c.scrollTop + el.getBoundingClientRect().top - c.getBoundingClientRect().top - marge, behavior: "smooth" });
  } else {
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - marge, behavior: "smooth" });
  }
}
