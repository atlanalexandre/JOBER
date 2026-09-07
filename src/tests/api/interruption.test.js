import { describe, it, expect } from "vitest";
import { partHoraire, nombreDeJours } from "../../../api/_cloture.js";

// Le partage d'une prestation interrompue en cours, tel que le calcule
// `cancel_in_progress`. Il rendait au client L'INTÉGRALITÉ des frais de
// service, contrairement à la règle appliquée partout ailleurs : ils
// rémunèrent la mise en relation, pas les heures.
const partager = (mission, heuresFacturees) => {
  const paye = Number(mission.montant_total || 0);
  const jours = nombreDeJours(mission);
  const partPrevue = partHoraire(mission, Number(mission.hours) || 0, jours);
  const fraisService = (partPrevue > 0 && paye > partPrevue)
    ? Math.round((paye - partPrevue) * 100) / 100
    : 0;
  const partPrestataire = partHoraire(mission, heuresFacturees, 1);
  const totalClient = Math.round((partPrestataire + fraisService) * 100) / 100;
  return {
    partPrestataire, fraisService, totalClient,
    remboursement: Math.max(0, Math.round((paye - totalClient) * 100) / 100),
  };
};

// Le cas réel : 4 h à 15 €/h, 60 € + 6,10 € de frais = 66,10 €.
const PRESTATION = { hours: 4, tarif_horaire: 15, montant_total: 66.10 };

describe("interruption en cours de prestation", () => {
  it("conserve les frais de service à ALANE", () => {
    const r = partager(PRESTATION, 3);
    expect(r.partPrestataire).toBe(45);
    expect(r.fraisService).toBe(6.10);
    expect(r.remboursement).toBe(15);
    // Avant : 21,10 € remboursés, et zéro pour ALANE.
  });

  it("ne perd ni ne crée d'argent", () => {
    for (const h of [1, 2, 3, 4]) {
      const r = partager(PRESTATION, h);
      const total = Math.round((r.partPrestataire + r.fraisService + r.remboursement) * 100) / 100;
      expect(total, `${h} h facturée(s)`).toBe(PRESTATION.montant_total);
    }
  });

  it("ne rembourse rien quand la prestation est allée à son terme", () => {
    const r = partager(PRESTATION, 4);
    expect(r.partPrestataire).toBe(60);
    expect(r.remboursement).toBe(0);
  });

  // Les frais se déduisent de l'encaissement réel, jamais d'une grille
  // recopiée : une grille recopiée finit toujours par diverger.
  it("suit le montant réellement encaissé, quel qu'il soit", () => {
    expect(partager({ hours: 8, tarif_horaire: 20, montant_total: 173.10 }, 5).fraisService).toBe(13.10);
    expect(partager({ hours: 2, tarif_horaire: 12, montant_total: 33.38 }, 1).fraisService).toBe(9.38);
  });

  it("ne retient aucun frais si le client n'en a pas payé", () => {
    // Prestation réglée au seul tarif horaire : rien à conserver.
    const r = partager({ hours: 4, tarif_horaire: 15, montant_total: 60 }, 2);
    expect(r.fraisService).toBe(0);
    expect(r.partPrestataire).toBe(30);
    expect(r.remboursement).toBe(30);
  });

  // La prolongation porte son propre tarif (CGPS art. 6.2) : la calculer au
  // tarif de base prendrait son écart au prestataire.
  it("respecte le tarif des heures supplémentaires", () => {
    const avecSupp = { hours: 2, tarif_horaire: 15, extra_hours_appliquees: 1, extra_hours_tarif: 17, montant_total: 51.54 };
    expect(partager(avecSupp, 2).partPrestataire).toBe(32);   // 1 h à 15 € + 1 h à 17 €
  });
});
