// Les heures supplémentaires n'étaient facturées à PERSONNE. Le client
// demandait, le prestataire acceptait, et le code se contentait d'augmenter
// `hours`. Aucun paiement complémentaire n'était réclamé.
//
// À la clôture, la part du prestataire suit les heures, et les frais de service
// se déduisent de ce qui reste du montant encaissé. Avec des heures gonflées et
// un encaissement inchangé, les deux dérivent ensemble : ALANE versait plus
// qu'elle n'avait encaissé, et perdait sa rémunération au passage.
//
// Le premier test reproduit la perte, chiffres à l'appui. Il n'existe pas pour
// vérifier le code d'aujourd'hui — il existe pour que personne ne rétablisse
// l'ancien comportement en croyant simplifier.

import { describe, it, expect } from "vitest";
import { prixHeuresSupp, tarifSuppValide, TARIF_SUPP_MIN, TARIF_SUPP_MAX } from "../../../api/_heures_supp.js";
import { montantsDeCloture } from "../../../api/_cloture.js";
import { FRAIS_PAR_DEFAUT } from "../../../api/_montant.js";

describe("la perte que ce module évite", () => {
  it("prolonger sans facturer faisait verser plus que l'encaissement", () => {
    // 1 h à 15 €/h, client débité 19,90 € (15 € + 4,90 € de frais).
    const encaisse = 19.90;
    const avant = { montant_total: encaisse, tarif_horaire: 15, hours: 1, actual_hours: 1 };
    expect(montantsDeCloture(avant).partPrestataire).toBe(15);
    expect(montantsDeCloture(avant).fraisService).toBeCloseTo(4.90, 2);

    // L'ancien code : `hours` passe à 2, `montant_total` ne bouge pas.
    const apres = { montant_total: encaisse, tarif_horaire: 15, hours: 2, actual_hours: null };
    const c = montantsDeCloture(apres);
    expect(c.partPrestataire).toBe(30);
    expect(c.fraisService).toBe(0);            // les frais s'évaporent aussi
    expect(c.partPrestataire - encaisse).toBeCloseTo(10.10, 2);
  });

  it("en facturant la prolongation, l'encaissement suit la durée", () => {
    const devis = prixHeuresSupp(1, 15, 1, FRAIS_PAR_DEFAUT);
    const apres = {
      montant_total: 19.90 + devis.total,
      tarif_horaire: 15, hours: 2, actual_hours: null,
    };
    const c = montantsDeCloture(apres);
    expect(c.partPrestataire).toBe(30);
    // Ce qui reste après la part horaire redevient les frais de service.
    expect(c.fraisService).toBeGreaterThan(0);
    expect(apres.montant_total).toBeGreaterThanOrEqual(c.partPrestataire);
  });
});

describe("prix d'une prolongation", () => {
  it("facture les heures au tarif annoncé par le prestataire", () => {
    expect(prixHeuresSupp(2, 20, 1, FRAIS_PAR_DEFAUT).partPrestataire).toBe(40);
  });

  // Le prestataire fixe librement son prix (CGPS art. 6.1). Une prolongation
  // imprévue n'a pas de raison d'être vendue au tarif d'un créneau réservé.
  it("accepte un tarif différent de celui de la prestation initiale", () => {
    const a = prixHeuresSupp(1, 15, 1, FRAIS_PAR_DEFAUT);
    const b = prixHeuresSupp(1, 25, 1, FRAIS_PAR_DEFAUT);
    expect(b.partPrestataire).toBeGreaterThan(a.partPrestataire);
  });

  it("multiplie par le nombre de jours d'une prestation récurrente", () => {
    expect(prixHeuresSupp(1, 15, 3, FRAIS_PAR_DEFAUT).partPrestataire).toBe(45);
  });

  // La part FIXE des frais rémunère la mise en relation : elle a déjà eu lieu,
  // et elle est déjà payée. Seule la part proportionnelle reste due — c'est elle
  // qui couvre les frais du prestataire de services de paiement.
  it("ne facture pas une seconde fois la part fixe des frais de service", () => {
    const d = prixHeuresSupp(1, 100, 1, FRAIS_PAR_DEFAUT);
    expect(d.fraisService).toBeCloseTo(100 * FRAIS_PAR_DEFAUT.pourcentage / 100, 2);
    expect(d.fraisService).toBeLessThan(FRAIS_PAR_DEFAUT.single);
  });

  it("le total est la somme des deux, en centimes entiers", () => {
    const d = prixHeuresSupp(1, 15, 1, FRAIS_PAR_DEFAUT);
    expect(d.total).toBeCloseTo(d.partPrestataire + d.fraisService, 2);
    expect(d.centimes).toBe(Math.round(d.total * 100));
    expect(Number.isInteger(d.centimes)).toBe(true);
  });

  // Un montant deviné ne doit jamais être encaissé : l'appelant refuse quand le
  // total est nul.
  it("renvoie zéro plutôt qu'un montant deviné", () => {
    for (const [h, t] of [[0, 15], [-1, 15], [1, 0], [1, -5], [1, null], [null, 15], ["x", "y"]]) {
      expect(prixHeuresSupp(h, t, 1, FRAIS_PAR_DEFAUT).total).toBe(0);
    }
  });
});

describe("bornes du tarif proposé", () => {
  it("refuse un tarif nul ou négatif", () => {
    expect(tarifSuppValide(0)).toBe(false);
    expect(tarifSuppValide(-10)).toBe(false);
  });

  // Garde-fou contre la faute de frappe — 150 au lieu de 15 — et non un
  // encadrement des prix : le plafond est très au-dessus de tout tarif légitime.
  it("refuse un tarif aberrant", () => {
    expect(tarifSuppValide(TARIF_SUPP_MAX + 1)).toBe(false);
    expect(tarifSuppValide(TARIF_SUPP_MAX)).toBe(true);
    expect(tarifSuppValide(TARIF_SUPP_MIN)).toBe(true);
  });

  it("refuse ce qui n'est pas un nombre", () => {
    for (const v of [null, undefined, "abc", NaN, Infinity, {}]) {
      expect(tarifSuppValide(v)).toBe(false);
    }
  });
});
