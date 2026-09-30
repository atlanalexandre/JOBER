// Files traitées par lots, dans les tâches planifiées.
/**
 * `n` éléments tirés au hasard (Fisher-Yates). Sert aux files traitées par
 * lots : un élément qui échoue à chaque passage ne doit pas occuper sa place en
 * tête pour toujours.
 */
export function tirerAuHasard(liste, n) {
  const copie = Array.isArray(liste) ? [...liste] : [];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie.slice(0, n);
}
