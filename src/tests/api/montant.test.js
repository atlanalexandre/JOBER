import { describe, it, expect } from "vitest";
import { verifierMontant, calculerFrais, nombreDeJours, FRAIS_PAR_DEFAUT } from "../../../api/_montant.js";

// ═══════════════════════════════════════════════════════════════════════════
// Cohérence du montant encaissé
// ═══════════════════════════════════════════════════════════════════════════
//
// La ligne `missions` est insérée par le navigateur du client. La garde SQL ne
// pose qu'une borne basse — elle refuse des frais de service négatifs, pas des
// frais nuls. C'est donc ce contrôle, et lui seul, qui empêche un client de
// s'exonérer de la rémunération d'ALANE. Il garde deux caisses : la carte et le
// portefeuille prépayé.

// { single: 4,90 · range: 2,90/jour · urgent: 9,90 · pourcentage: 2 }
const F = FRAIS_PAR_DEFAUT;

describe("nombreDeJours", () => {
  it("vaut 1 pour une prestation ponctuelle", () => {
    expect(nombreDeJours({})).toBe(1);
    expect(nombreDeJours({ date_debut: "2026-08-10" })).toBe(1);
  });
  it("compte les deux bornes incluses", () => {
    expect(nombreDeJours({ date_debut: "2026-08-10", date_fin: "2026-08-10" })).toBe(1);
    expect(nombreDeJours({ date_debut: "2026-08-10", date_fin: "2026-08-14" })).toBe(5);
  });
  it("ne rend jamais moins de 1, même sur des dates incohérentes", () => {
    expect(nombreDeJours({ date_debut: "2026-08-14", date_fin: "2026-08-10" })).toBe(1);
    expect(nombreDeJours({ date_debut: "n'importe quoi", date_fin: "2026-08-10" })).toBe(1);
  });
});

describe("verifierMontant — prestation ponctuelle", () => {
  const m = { tarif_horaire: 15, hours: 4 }; // part horaire = 60 €

  it("accepte le tarif plus les frais ponctuels, part variable comprise", () => {
    // 60 € de prestation → 4,90 € fixe + 2 % de 60 € = 6,10 €
    expect(verifierMontant(m, 66.10, F).ok).toBe(true);
  });

  it("accepte le tarif plus les frais d'urgence", () => {
    expect(verifierMontant(m, 60 + 9.90 + 1.20, F).ok).toBe(true);
  });

  it("REFUSE le tarif sans aucun frais de service", () => {
    // C'est l'attaque : la garde SQL laisse passer ce montant, il n'est refusé
    // qu'ici. Sans ce contrôle, ALANE ne perçoit rien sur la réservation.
    const v = verifierMontant(m, 60, F);
    expect(v.ok).toBe(false);
    expect(v.fraisConstates).toBe(0);
  });

  it("refuse un total inventé", () => {
    expect(verifierMontant(m, 61, F).ok).toBe(false);
    expect(verifierMontant(m, 1, F).ok).toBe(false);
    expect(verifierMontant(m, 1000, F).ok).toBe(false);
  });

  it("tolère un centime d'écart, dans les deux sens, pas davantage", () => {
    // La comparaison se fait en centimes entiers : en euros flottants,
    // 64.89 − 60 valait 4.890000000000001 et l'écart d'un centime sortait de la
    // tolérance. Un montant juste était refusé.
    expect(verifierMontant(m, 66.11, F).ok).toBe(true);
    expect(verifierMontant(m, 66.09, F).ok).toBe(true);
    expect(verifierMontant(m, 66.12, F).ok).toBe(false);
    expect(verifierMontant(m, 66.08, F).ok).toBe(false);
    expect(verifierMontant(m, 66.15, F).ok).toBe(false);
  });
});

describe("verifierMontant — prestation récurrente", () => {
  // 3 jours, 2 h par jour à 20 € : part horaire 40 € × 3 = 120 €
  const m = { tarif_horaire: 20, hours: 2, date_debut: "2026-08-10", date_fin: "2026-08-12" };

  it("multiplie la part FIXE par le nombre de jours, et la variable sur le total", () => {
    // 2,90 × 3 jours = 8,70 € de fixe, plus 2 % de 120 € = 2,40 €
    expect(verifierMontant(m, 120 + 8.70 + 2.40, F).ok).toBe(true);
  });

  it("multiplie aussi la part horaire par le nombre de jours", () => {
    const v = verifierMontant(m, 120 + 8.70 + 2.40, F);
    expect(v.partHoraire).toBe(40);
    expect(v.nbJours).toBe(3);
  });

  it("refuse des frais « range » comptés une seule fois", () => {
    expect(verifierMontant(m, 120 + 2.90, F).ok).toBe(false);
  });

  it("refuse le tarif seul sur plusieurs jours", () => {
    expect(verifierMontant(m, 120, F).ok).toBe(false);
  });
});

describe("verifierMontant — barème modifié par l'administration", () => {
  it("suit le barème fourni, pas les valeurs codées en dur", () => {
    const m = { tarif_horaire: 10, hours: 1 };
    const bareme = { single: 7.50, range: 3.50, urgent: 12, pourcentage: 0 };
    expect(verifierMontant(m, 17.50, bareme).ok).toBe(true);
    expect(verifierMontant(m, 14.90, bareme).ok).toBe(false); // ancien barème
  });
});

describe("verifierMontant — cas non vérifiables", () => {
  // Sans part horaire, la décomposition n'a pas de sens. On laisse passer
  // plutôt que de bloquer un encaissement légitime sur un cas hors grille.
  it("laisse passer une prestation sans tarif horaire", () => {
    expect(verifierMontant({ tarif_horaire: 0, hours: 4 }, 50, F).ok).toBe(true);
    expect(verifierMontant({ hours: 4 }, 50, F).ok).toBe(true);
  });
  it("laisse passer une prestation sans durée", () => {
    expect(verifierMontant({ tarif_horaire: 15, hours: 0 }, 50, F).ok).toBe(true);
  });
  it("ne lève pas sur une mission absente", () => {
    expect(verifierMontant(null, 50, F).ok).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// calculerFrais — la part variable
// ═══════════════════════════════════════════════════════════════════════════
//
// Elle couvre les frais du prestataire de services de paiement, proportionnels
// au montant encaissé. Une part fixe seule suffit sur une petite prestation et
// devient déficitaire au-delà de quelques centaines d'euros.

describe("calculerFrais", () => {
  it("ajoute la part variable à la part fixe", () => {
    expect(calculerFrais("single", 112, 1, F)).toBe(7.14); // 4,90 + 2 % de 112
    expect(calculerFrais("urgent", 112, 1, F)).toBe(12.14);
  });

  it("compte la part fixe PAR JOUR en multi-dates, la variable une seule fois", () => {
    // 2,90 × 5 jours = 14,50 €, plus 2 % de 560 € = 11,20 €
    expect(calculerFrais("range", 560, 5, F)).toBe(25.70);
  });

  it("reste bénéficiaire sur les gros montants — c'est sa raison d'être", () => {
    // Sur 1 000 €, un forfait de 4,90 € ne couvrirait pas les ~15 € prélevés
    // par le prestataire de paiement. Avec 2 %, les frais suivent le montant.
    expect(calculerFrais("single", 1000, 1, F)).toBe(24.90);
  });

  it("suit le pourcentage du barème, y compris à zéro", () => {
    expect(calculerFrais("single", 500, 1, { ...F, pourcentage: 0 })).toBe(4.90);
    expect(calculerFrais("single", 500, 1, { ...F, pourcentage: 5 })).toBe(29.90);
  });

  it("ne rend jamais de centime flottant", () => {
    expect(calculerFrais("single", 64.89, 1, F)).toBe(6.20);
    expect(calculerFrais("single", 33.33, 1, F)).toBe(5.57);
  });

  it("ignore un prix négatif plutôt que de réduire les frais", () => {
    expect(calculerFrais("single", -100, 1, F)).toBe(4.90);
  });
});
