import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { offreActive, moisFr, PLACES_OFFRE } from "../../../api/_offre.js";

// L'offre de lancement a changé de fait générateur trois fois, et chaque fois
// pour la même raison : une place consommée par quelqu'un qui ne travaille pas.
//
//   • à l'INSCRIPTION — un compte refusé gardait sa place ;
//   • à l'OUVERTURE DE L'ACCÈS (24/08/2026) — un compte validé qui ne
//     travaillait jamais la gardait aussi ;
//   • à la PREMIÈRE PRESTATION ACCEPTÉE (15/09/2026), et pour le seul mois de
//     ce déclenchement.

describe("moisFr()", () => {
  // Vercel tourne en UTC. Le 1er octobre à 00 h 30 heure française est encore
  // le 30 septembre en UTC : comparer les mois sur `toISOString()` prolongerait
  // l'offre de deux heures pour les uns et l'amputerait pour les autres.
  it("compte les mois en heure de Paris, pas en UTC", () => {
    expect(moisFr("2026-09-30T23:00:00Z")).toBe("2026-10");
    expect(moisFr("2026-09-30T21:00:00Z")).toBe("2026-09");
  });

  it("ne s'effondre pas sur une date illisible", () => {
    expect(moisFr("pas une date")).toBeNull();
  });
});

describe("offreActive()", () => {
  const LE_15_SEPT = Date.parse("2026-09-15T12:00:00Z");

  it("vaut pour le mois du déclenchement", () => {
    expect(offreActive("2026-09-01T08:00:00Z", LE_15_SEPT)).toBe(true);
    expect(offreActive("2026-09-15T11:00:00Z", LE_15_SEPT)).toBe(true);
  });

  // La règle voulue par Alexandre : l'offre se clôture à la fin du mois du
  // déclenchement, quel que soit le jour où elle a commencé.
  it("s'arrête au mois suivant", () => {
    expect(offreActive("2026-08-30T12:00:00Z", LE_15_SEPT)).toBe(false);
    expect(offreActive("2026-07-03T08:00:00Z", LE_15_SEPT)).toBe(false);
  });

  // Le 31 août à 22 h UTC, il est déjà le 1er septembre à Paris : le
  // déclenchement compte donc pour septembre. C'est ce que vaut le passage par
  // le fuseau — un `toISOString()` aurait rattaché ce prestataire à août et lui
  // aurait retiré son offre le jour même où elle commençait.
  it("rattache la dernière nuit du mois au bon mois", () => {
    expect(offreActive("2026-08-31T22:00:00Z", LE_15_SEPT)).toBe(true);
    expect(offreActive("2026-08-31T20:00:00Z", LE_15_SEPT)).toBe(false);
  });

  it("ne vaut jamais sans déclenchement", () => {
    for (const v of [null, undefined, "", "pas une date"]) {
      expect(offreActive(v, LE_15_SEPT)).toBe(false);
    }
  });

  // Effet connu et assumé : accepter sa première prestation le 28 ne laisse que
  // trois jours d'offre. La règle est délibérée — si ce test tombe, c'est que
  // quelqu'un l'a « corrigée » sans le demander.
  it("n'accorde que le reliquat du mois à un déclenchement tardif", () => {
    const le28 = "2026-09-28T09:00:00Z";
    expect(offreActive(le28, Date.parse("2026-09-30T20:00:00Z"))).toBe(true);
    expect(offreActive(le28, Date.parse("2026-10-01T09:00:00Z"))).toBe(false);
  });
});

describe("le déclenchement, côté serveur", () => {
  const missions = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const offre = readFileSync(new URL("../../../api/_offre.js", import.meta.url), "utf8");

  // Quatre chemins mènent à une prestation acceptée : le lien d'un courriel,
  // l'action `accept` de l'application, la réponse à une demande directe, et la
  // reprise d'un remplacement. En oublier un priverait quelqu'un de son offre
  // pour un motif purement technique.
  it("couvre les quatre chemins d'acceptation", () => {
    const appels = missions.match(/declencherOffreLancement\(/g) || [];
    expect(appels.length, "un chemin d'acceptation ne déclenche pas l'offre").toBeGreaterThanOrEqual(4);
  });

  // Écrire sous condition `is.null` en base, plutôt que lire puis écrire :
  // deux acceptations simultanées ne doivent pas repousser la date.
  it("n'écrase jamais une date déjà posée", () => {
    expect(offre).toContain("offre_lancement_at=is.null");
  });

  // Une offre non déclenchée ne doit pas faire échouer l'acceptation d'une
  // prestation — mais elle doit se voir dans les journaux.
  it("ne fait pas échouer l'acceptation si elle échoue", () => {
    expect(offre).toContain("console.error");
    expect(offre).toMatch(/catch/);
    expect(offre).not.toMatch(/throw new/);
  });

  it("classe les 100 premiers sur la date de déclenchement", () => {
    expect(missions).toContain("offre_lancement_at=not.is.null");
    expect(missions).toContain("order=offre_lancement_at.asc");
    expect(PLACES_OFFRE).toBe(100);
  });

  // Être dans les 100 ne suffit pas : la place reste prise à vie, l'offre ne
  // dure que le mois du déclenchement.
  it("exige d'être dans les 100 ET dans le mois", () => {
    expect(missions).toContain("offreActive(place.offre_lancement_at)");
  });
});

// Annoncer autre chose que ce que le serveur applique est une pratique
// commerciale trompeuse (art. L121-2 du Code de la consommation). C'est déjà
// arrivé deux fois sur cette offre.
describe("ce qui est annoncé correspond à ce qui est appliqué", () => {
  const ui = readFileSync(new URL("../../components/ui.jsx", import.meta.url), "utf8");
  const presta = readFileSync(new URL("../../components/presta-screens.jsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../../../api/prestataires.js", import.meta.url), "utf8");

  it("le libellé ne promet plus l'offre aux seuls « validés »", () => {
    expect(ui).not.toContain("Réservé aux 100 premiers prestataires validés");
    expect(ui).toMatch(/accepter une prestation/);
  });

  it("les deux compteurs de places comptent la même chose que le serveur", () => {
    expect(api).toContain("offre_lancement_at=not.is.null");
    expect(presta).toContain('not("offre_lancement_at","is",null)');
  });
});
