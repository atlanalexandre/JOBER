// Une seule barre de navigation par espace (12/10/2026) : « Accueil » et
// « Prestations » ouvraient le même écran côté prestataire, sous une seconde
// barre d'onglets qui répétait la première.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SCREEN_TO_PATH } from "../lib/routes.js";

const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const presta = readFileSync(new URL("../components/presta-screens.jsx", import.meta.url), "utf8");
const idsDe = (bloc) => [...bloc.matchAll(/\{\s*id:"([a-z_]+)"/g)].map(m => m[1]);
const blocApres = (src, debut, fin = "];") => { const i = src.indexOf(debut); return src.slice(i, src.indexOf(fin, i)); };

describe("barre prestataire", () => {
  const barre = idsDe(blocApres(app, "function PrestaNav"));
  it("Accueil, Prestations, Planning, Revenus, Profil — dans cet ordre", () => {
    expect(barre).toEqual(["p_home", "p_missions", "calendar", "p_revenus", "p_dashboard"]);
  });
  it("chaque onglet a son adresse et appartient à l'espace prestataire", () => {
    const ecrans = blocApres(app, "const PRESTA_SCREENS=");
    for (const id of barre) {
      expect(SCREEN_TO_PATH[id], id).toBeTruthy();
      expect(ecrans, id).toContain(`"${id}"`);
    }
  });
  it("chaque onglet de la barre est une vue du tableau de bord (la liste, donc le pointage, y reste montée)", () => {
    const vues = blocApres(presta, "const VUE_PAR_ECRAN", "};");
    for (const id of barre) expect(vues, id).toContain(`${id}:`);
    expect(app).toContain('screen==="calendar"||screen==="p_revenus"');
    expect(app).toContain("planning={<CalendarScreen />}");
  });
  it("le guide montre la même barre", () => {
    expect(idsDe(blocApres(presta, "const ONGLETS_PRESTA_GUIDE"))).toEqual(barre);
  });
  it("plus de seconde barre d'onglets dans le tableau de bord", () => {
    expect(presta).not.toMatch(/\{id:"historique",l:"Historique"\}/);
    expect(presta).not.toMatch(/tab===/);
  });
  it("l'accueil résume ; une seule liste, visible dans Prestations › En cours", () => {
    const debut = presta.indexOf('{vue==="accueil" && <>');
    const bloc = presta.slice(debut, presta.indexOf("</>}", debut));
    expect(bloc).toContain("<ResumeDuJour");
    expect(bloc).not.toContain("<PMissionsTab");
    // Une seule instance dans le tableau de bord (deux lisaient my_missions en double).
    const tableau = presta.slice(presta.indexOf("export function PrestaDashboard("));
    expect((tableau.match(/<PMissionsTab /g) || []).length).toBe(1);
    expect(tableau).toContain('display: listeVisible ? "block" : "none"');
    expect(tableau).toContain("onResume={setResume}");
  });
  it("les avertissements d'acceptation sont aussi dans Prestations", () => {
    const debut = presta.indexOf('{vue==="prestations" && sousPrestations==="en_cours" && <>');
    expect(presta.slice(debut, presta.indexOf("</>}", debut))).toContain("{alertesAcceptation}");
  });
});

describe("barre client", () => {
  const barre = idsDe(blocApres(app, "function ClientNav"));
  it("Accueil, Chercher, Prestations, Compte — sans doublon de Réglages", () => {
    expect(barre).toEqual(["home", "search_filters", "mission_history", "dashboard"]);
  });
  it("l'onglet Prestations garde la barre affichée", () => {
    const ecrans = blocApres(app, "const clientScreens=");
    for (const id of barre) expect(ecrans, id).toContain(`"${id}"`);
  });
});
