import { describe, it, expect } from "vitest";
import { verifierMontant, nombreDeJours, FRAIS_PAR_DEFAUT } from "../../../api/_montant.js";

// ═══════════════════════════════════════════════════════════════════════════
// Cohérence du montant encaissé
// ═══════════════════════════════════════════════════════════════════════════
//
// La ligne `missions` est insérée par le navigateur du client. La garde SQL ne
// pose qu'une borne basse — elle refuse des frais de service négatifs, pas des
// frais nuls. C'est donc ce contrôle, et lui seul, qui empêche un client de
// s'exonérer de la rémunération d'ALANE. Il garde deux caisses : la carte et le
// portefeuille prépayé.

const F = FRAIS_PAR_DEFAUT; // { single: 4.90, range: 2.90, urgent: 9.90 }

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

  it("accepte le tarif plus les frais ponctuels", () => {
    expect(verifierMontant(m, 64.90, F).ok).toBe(true);
  });

  it("accepte le tarif plus les frais d'urgence", () => {
    expect(verifierMontant(m, 69.90, F).ok).toBe(true);
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
    expect(verifierMontant(m, 64.91, F).ok).toBe(true);
    expect(verifierMontant(m, 64.89, F).ok).toBe(true);
    expect(verifierMontant(m, 64.92, F).ok).toBe(false);
    expect(verifierMontant(m, 64.88, F).ok).toBe(false);
    expect(verifierMontant(m, 64.95, F).ok).toBe(false);
  });
});

describe("verifierMontant — prestation récurrente", () => {
  // 3 jours, 2 h par jour à 20 € : part horaire 40 € × 3 = 120 €
  const m = { tarif_horaire: 20, hours: 2, date_debut: "2026-08-10", date_fin: "2026-08-12" };

  it("multiplie les frais « range » par le nombre de jours", () => {
    expect(verifierMontant(m, 120 + 2.90 * 3, F).ok).toBe(true);
  });

  it("multiplie aussi la part horaire par le nombre de jours", () => {
    const v = verifierMontant(m, 120 + 8.70, F);
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
    const bareme = { single: 7.50, range: 3.50, urgent: 12 };
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
