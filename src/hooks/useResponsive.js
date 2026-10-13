import { useState, useEffect } from "react";

// Téléphone ou ordinateur ? (14/10/2026)
//
// La mesure était `window.innerWidth < 768`. Sur iPhone, `innerWidth` suit la
// zone VISIBLE, qui change avec le zoom ; et un grand téléphone tenu à
// l'horizontale dépasse 768 px. Dans les deux cas l'application basculait en
// mise en page d'ordinateur — sans la barre du bas, qui « disparaissait »
// (signalé par Alexandre le 13/10/2026).
//
// La requête média lit la largeur de la mise en page, que le zoom ne modifie
// pas. Et un écran tactile de moins de 500 px de haut reste un téléphone, même
// tenu à l'horizontale.
export const REQUETE_MOBILE = "(max-width: 767px), (pointer: coarse) and (max-height: 500px)";

export function estMobile() {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") return window.matchMedia(REQUETE_MOBILE).matches;
  return (document.documentElement?.clientWidth || window.innerWidth) < 768;
}

export const useResponsive = () => {
  const [isMobile, setIsMobile] = useState(estMobile);
  useEffect(() => {
    const handler = () => setIsMobile(estMobile());
    window.addEventListener("resize", handler);
    window.addEventListener("orientationchange", handler);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("orientationchange", handler);
    };
  }, []);
  return { isMobile, isDesktop: !isMobile };
};
