// L'écran est-il large (ordinateur) ? Utilisé par la page d'accueil (03/11/2026).
import { useState, useEffect } from "react";

/**
 * L'écran est-il assez large pour une mise en page d'ordinateur ? Suit le
 * redimensionnement. Sur ordinateur, l'accueil s'affichait en colonne de
 * téléphone, cartes empilées sur toute la hauteur (retour du 03/11/2026).
 */
export function useEcranLarge(seuil = 900) {
  const lire = () => typeof window !== "undefined" && window.innerWidth >= seuil;
  const [large, setLarge] = useState(lire);
  useEffect(() => {
    const suivre = () => setLarge(lire());
    window.addEventListener("resize", suivre);
    return () => window.removeEventListener("resize", suivre);
  }, [seuil]); // eslint-disable-line react-hooks/exhaustive-deps
  return large;
}
