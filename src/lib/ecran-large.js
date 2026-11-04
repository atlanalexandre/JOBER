// L'écran est-il large (ordinateur) ? Utilisé par la page d'accueil (03/11/2026).
import { useState, useEffect } from "react";
import { estMobile } from "../hooks/useResponsive.js";

/**
 * Vrai sur un écran d'ordinateur d'au moins `seuil` pixels de large.
 *
 * Même mesure que le reste de l'application (`useResponsive`), et non
 * `window.innerWidth` : sur iPhone, celui-ci suit le zoom, et un grand
 * téléphone tenu à l'horizontale (932 px) passait en mise en page
 * d'ordinateur — grille à deux colonnes et titre de 48 px dans un cadre de
 * téléphone (relecture du 04/11/2026). Un téléphone reste un téléphone.
 */
export function estEcranLarge(seuil = 900) {
  if (typeof window === "undefined" || estMobile()) return false;
  if (typeof window.matchMedia === "function") return window.matchMedia(`(min-width: ${seuil}px)`).matches;
  return (document.documentElement?.clientWidth || window.innerWidth) >= seuil;
}

export function useEcranLarge(seuil = 900) {
  const [large, setLarge] = useState(() => estEcranLarge(seuil));
  useEffect(() => {
    const suivre = () => setLarge(estEcranLarge(seuil));
    window.addEventListener("resize", suivre);
    window.addEventListener("orientationchange", suivre);
    return () => {
      window.removeEventListener("resize", suivre);
      window.removeEventListener("orientationchange", suivre);
    };
  }, [seuil]);
  return large;
}
