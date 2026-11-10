// ═══════════════════════════════════════════════════════════════════════════
// Faire défiler la page jusqu'à un élément (09/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// `scrollIntoView` fait défiler TOUS les conteneurs ancêtres, y compris ceux
// en `overflow: hidden` — le cadre décoratif de l'accueil en est un, plus
// large que l'écran. Sur téléphone, la page se décalait : le texte collait au
// bord gauche, le haut d'un bloc disparaissait (constaté le 09/11/2026 en
// ajoutant les cases « client » et « indépendant »). On ne fait défiler que
// le vrai conteneur de défilement, verticalement. L'application n'a plus
// aucun `scrollIntoView` (src/tests/affichage-mobile.test.js le vérifie).

/** Le premier ancêtre qui défile réellement (overflow-y auto ou scroll). */
function conteneurDefilant(el) {
  for (let c = el.parentElement; c; c = c.parentElement) {
    const oy = getComputedStyle(c).overflowY;
    if ((oy === "auto" || oy === "scroll") && c.scrollHeight > c.clientHeight) return c;
  }
  return null;
}

/**
 * Amène `el` en haut de l'écran, `marge` pixels sous le bord — davantage
 * quand une barre collante (`position: sticky`) le masquerait.
 */
export function defilerVersElement(el, marge = 16) {
  if (!el) return;
  const c = conteneurDefilant(el);
  if (c) {
    c.scrollTo({ top: c.scrollTop + el.getBoundingClientRect().top - c.getBoundingClientRect().top - marge, behavior: "smooth" });
  } else {
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - marge, behavior: "smooth" });
  }
}

/** Amène la section `id` en haut de l'écran. */
export function defilerVers(id, marge = 16) {
  defilerVersElement(document.getElementById(id), marge);
}

/** Descend tout en bas du conteneur qui porte `el` (le dernier message d'une conversation). */
export function defilerEnBas(el) {
  if (!el) return;
  const c = conteneurDefilant(el);
  if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
  else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
}
