import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SCREEN_TO_PATH, PUBLIC_SCREENS, NEEDS_DATA, PATH_TO_SCREEN } from "../lib/routes.js";
import { IMMATRICULEE, EDITEUR, blocEditeur, blocHebergeurs, blocResponsableTraitement } from "../constants/editeur.js";

// L'article 6-III de la loi pour la confiance dans l'économie numérique impose
// que l'identité de l'éditeur soit accessible « de manière directe et
// permanente ». Elle ne l'était pas : la page n'existait qu'à l'intérieur du
// menu d'un compte client, et son contenu portait des marqueurs « [À REMPLIR] »
// affichés tels quels à l'utilisateur.

describe("accès aux mentions légales", () => {
  it("a sa propre adresse", () => {
    expect(SCREEN_TO_PATH.mentions_legales).toBe("/mentions-legales");
    expect(PATH_TO_SCREEN["/mentions-legales"]).toBe("mentions_legales");
  });

  it("est accessible sans compte", () => {
    expect(PUBLIC_SCREENS.has("mentions_legales")).toBe(true);
  });

  // Un écran classé NEEDS_DATA n'est pas restauré au chargement direct : l'URL
  // partagée retomberait sur l'accueil, et l'accès « permanent » ne le serait
  // plus.
  it("se recharge depuis son URL seule", () => {
    expect(NEEDS_DATA.has("mentions_legales")).toBe(false);
  });

  it("est atteignable depuis l'accueil public, le compte client et l'espace prestataire", () => {
    const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
    const client = readFileSync(new URL("../components/client-screens.jsx", import.meta.url), "utf8");
    // Page d'accueil, pour le visiteur sans compte.
    expect(app).toContain('onMentions={()=>navigate("mentions_legales")}');
    // Espace prestataire, qui n'avait aucun lien.
    expect(app).toContain('navigate("mentions_legales")');
    expect(client).toContain('onNavigate("mentions_legales")');
  });
});

describe("contenu des mentions légales", () => {
  it("n'affiche jamais de marqueur de rédaction", () => {
    const textes = [blocEditeur(), blocHebergeurs(), blocResponsableTraitement()].join("\n");
    expect(textes).not.toMatch(/À REMPLIR|\[[^\]]*\]|TODO|FIXME/);
  });

  it("nomme les hébergeurs, qui ne dépendent d'aucune immatriculation", () => {
    const h = blocHebergeurs();
    expect(h).toContain("Vercel Inc.");
    expect(h).toContain("Supabase Inc.");
  });

  // Tant que la société n'existe pas, la page doit le DIRE. Un bloc éditeur
  // vide ou à demi rempli a l'air complet, et c'est le pire des deux états.
  it("annonce l'absence d'immatriculation tant qu'elle dure", () => {
    if (IMMATRICULEE) return;
    const b = blocEditeur();
    expect(b).toMatch(/en cours de constitution/);
    expect(b).toContain("direction@alane.fr");
  });

  // Le jour de l'immatriculation, on passe le drapeau à `true`. Ce test rend
  // alors la liste des champs qui restent à remplir — et échoue tant qu'il en
  // manque un, plutôt que de publier une identification partielle.
  it("exige tous les champs une fois immatriculée", () => {
    if (!IMMATRICULEE) return;
    const obligatoires = ["denomination", "formeJuridique", "capital", "siren", "siret", "rcs", "ape", "siege", "directeurPublication"];
    const manquants = obligatoires.filter(k => !String(EDITEUR[k] || "").trim());
    expect(manquants, `champs vides : ${manquants.join(", ")}`).toEqual([]);
  });
});
