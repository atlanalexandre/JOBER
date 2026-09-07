import { describe, it, expect } from "vitest";
import { montantsDeCloture } from "../../../api/_cloture.js";

// Le partage d'une prestation interrompue en cours, tel que le calcule
// `cancel_in_progress`. Deux défauts sont surveillés ici.
//
// 1. Le remboursement rendait au client L'INTÉGRALITÉ des frais de service,
//    contrairement à la règle appliquée partout ailleurs : ils rémunèrent la
//    mise en relation, pas les heures.
// 2. Sur une prestation récurrente, interrompre une journée mettait fin à toute
//    la prestation et ne comptait QUE la journée entamée : un prestataire qui
//    avait travaillé lundi et mardi, interrompu mercredi, perdait ses deux
//    premières journées.
//
// Les tests appellent la vraie fonction, et non une copie du calcul : une copie
// reste juste jusqu'au jour où le code change sans elle.

// Le cas réel : 4 h à 15 €/h, 60 € + 6,10 € de frais = 66,10 €.
const PRESTATION = { hours: 4, tarif_horaire: 15, montant_total: 66.10 };

// Ce que le client récupère : ce qu'il a payé, moins ce qui reste dû.
const remboursement = (m, heuresPerdues) => {
  const r = montantsDeCloture({ ...m, heures_perdues: heuresPerdues });
  return { ...r, remboursement: Math.max(0, Math.round((Number(m.montant_total) - r.totalClient) * 100) / 100) };
};

describe("interruption en cours de prestation", () => {
  it("conserve les frais de service à ALANE", () => {
    const r = remboursement(PRESTATION, 1);          // 3 h faites sur 4
    expect(r.partPrestataire).toBe(45);
    expect(r.fraisService).toBe(6.10);
    expect(r.remboursement).toBe(15);
    // Avant : 21,10 € remboursés, et zéro pour ALANE.
  });

  it("ne perd ni ne crée d'argent", () => {
    for (const perdues of [0, 1, 2, 3, 4]) {
      const r = remboursement(PRESTATION, perdues);
      const total = Math.round((r.partPrestataire + r.fraisService + r.remboursement) * 100) / 100;
      expect(total, `${perdues} h non faite(s)`).toBe(PRESTATION.montant_total);
    }
  });

  it("ne rembourse rien quand la prestation est allée à son terme", () => {
    const r = remboursement(PRESTATION, 0);
    expect(r.partPrestataire).toBe(60);
    expect(r.remboursement).toBe(0);
  });

  // Les frais se déduisent de l'encaissement réel, jamais d'une grille
  // recopiée : une grille recopiée finit toujours par diverger.
  it("suit le montant réellement encaissé, quel qu'il soit", () => {
    expect(remboursement({ hours: 8, tarif_horaire: 20, montant_total: 173.10 }, 3).fraisService).toBe(13.10);
    expect(remboursement({ hours: 2, tarif_horaire: 12, montant_total: 33.38 }, 1).fraisService).toBe(9.38);
  });

  it("ne retient aucun frais si le client n'en a pas payé", () => {
    // Prestation réglée au seul tarif horaire : rien à conserver.
    const r = remboursement({ hours: 4, tarif_horaire: 15, montant_total: 60 }, 2);
    expect(r.fraisService).toBe(0);
    expect(r.partPrestataire).toBe(30);
    expect(r.remboursement).toBe(30);
  });

  // La prolongation porte son propre tarif (CGPS art. 6.2) : la calculer au
  // tarif de base prendrait son écart au prestataire.
  it("respecte le tarif des heures supplémentaires", () => {
    const avecSupp = { hours: 2, tarif_horaire: 15, extra_hours_appliquees: 1, extra_hours_tarif: 17, montant_total: 51.54 };
    expect(remboursement(avecSupp, 0).partPrestataire).toBe(32);   // 1 h à 15 € + 1 h à 17 €
  });
});

// ── Prestation récurrente ───────────────────────────────────────────────────
//
// 5 jours × 4 h à 15 €/h = 300 € + 20,50 € de frais = 320,50 €.
const RECURRENTE = {
  hours: 4, tarif_horaire: 15, montant_total: 320.50,
  date_debut: "2026-09-07", date_fin: "2026-09-11",
};

describe("interruption d'une journée d'une prestation récurrente", () => {
  it("compte les cinq journées quand rien n'est perdu", () => {
    const r = montantsDeCloture(RECURRENTE);
    expect(r.jours).toBe(5);
    expect(r.partPrestataire).toBe(300);
    expect(r.fraisService).toBe(20.50);
  });

  // La déduction porte sur le MONTANT, pas sur les heures : `heures_perdues`
  // est un total sur toute la prestation, `hours` un nombre d'heures PAR JOUR.
  // Les soustraire l'une de l'autre retirerait la perte cinq fois.
  it("ne retire les heures perdues qu'une seule fois", () => {
    const r = remboursement(RECURRENTE, 2);          // 2 h non faites, un seul jour
    expect(r.partPrestataire).toBe(270);             // et non 300 − 5×30
    expect(r.fraisService).toBe(20.50);
    expect(r.remboursement).toBe(30);
  });

  it("cumule deux journées écourtées", () => {
    const r = remboursement(RECURRENTE, 2 + 3);
    expect(r.partPrestataire).toBe(225);
    expect(r.remboursement).toBe(75);
  });

  // « Arrêter toute la prestation » le 3ᵉ jour après 2 h : 2 h perdues le jour
  // même, plus les deux journées suivantes.
  it("chiffre l'arrêt complet en cours de période", () => {
    const r = remboursement(RECURRENTE, 2 + 2 * 4);
    expect(r.partPrestataire).toBe(150);             // 8 h faites + 2 h du 3ᵉ jour
    expect(r.fraisService).toBe(20.50);
    expect(r.remboursement).toBe(150);
  });

  it("ne rend jamais au prestataire un montant négatif", () => {
    expect(montantsDeCloture({ ...RECURRENTE, heures_perdues: 999 }).partPrestataire).toBe(0);
  });

  it("conserve les frais de service même tout annulé", () => {
    const r = remboursement(RECURRENTE, 20);
    expect(r.partPrestataire).toBe(0);
    expect(r.fraisService).toBe(20.50);
    expect(r.remboursement).toBe(300);
  });
});
