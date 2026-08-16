import { describe, it, expect } from "vitest";
import {
  recapitulatifAnnuel, anneeARecapituler, recapitulatifDejaEnvoye, INFORMATION_FISCALE,
} from "../../../api/_fiscal.js";

const versee = (montant, retenue = 0) => ({
  payout_status: "transferred", payout_amount: montant, payout_compensation: retenue,
});

describe("recapitulatifAnnuel", () => {
  it("additionne les prestations réellement versées", () => {
    const r = recapitulatifAnnuel([versee(112), versee(84), versee(56)]);
    expect(r.operations).toBe(3);
    expect(r.brut).toBe(252);
    expect(r.verse).toBe(252);
  });

  it("ignore ce qui n'a pas été versé — en attente, retenu, échoué", () => {
    // Une prestation non versée n'a pas été perçue. La compter gonflerait un
    // chiffre d'affaires que l'intéressé recopiera dans sa déclaration.
    const r = recapitulatifAnnuel([
      versee(112),
      { payout_status: "pending", payout_amount: 500 },
      { payout_status: "held", payout_amount: 300 },
      { payout_status: "failed", payout_amount: 200 },
    ]);
    expect(r.operations).toBe(1);
    expect(r.brut).toBe(112);
  });

  it("compte les retenues dans le brut, et les isole du versé", () => {
    // La retenue fait partie du chiffre d'affaires perçu même si elle n'a pas
    // transité par la banque du prestataire.
    const r = recapitulatifAnnuel([versee(200, 50)]);
    expect(r.brut).toBe(200);
    expect(r.retenues).toBe(50);
    expect(r.verse).toBe(150);
  });

  it("ne produit pas de centime flottant", () => {
    const r = recapitulatifAnnuel([versee(64.89), versee(21.30), versee(13.81)]);
    expect(r.brut).toBe(100);
  });

  it("rend des zéros sur une liste vide ou absente", () => {
    for (const entree of [[], null, undefined]) {
      const r = recapitulatifAnnuel(entree);
      expect(r).toEqual({ operations: 0, brut: 0, retenues: 0, verse: 0 });
    }
  });
});

describe("anneeARecapituler", () => {
  it("rend l'année précédente pendant le mois de janvier", () => {
    expect(anneeARecapituler(new Date("2027-01-15T10:00:00Z"))).toBe(2026);
    expect(anneeARecapituler(new Date("2027-01-01T00:00:00Z"))).toBe(2026);
    expect(anneeARecapituler(new Date("2027-01-31T23:59:00Z"))).toBe(2026);
  });

  it("rend null hors janvier — un récapitulatif en juillet ne remplit rien", () => {
    expect(anneeARecapituler(new Date("2026-08-16T10:00:00Z"))).toBeNull();
    expect(anneeARecapituler(new Date("2026-12-31T23:59:00Z"))).toBeNull();
    expect(anneeARecapituler(new Date("2027-02-01T00:00:00Z"))).toBeNull();
  });
});

describe("recapitulatifDejaEnvoye", () => {
  it("considère envoyé si l'envoi date de l'année suivant celle récapitulée", () => {
    expect(recapitulatifDejaEnvoye("2027-01-05T09:00:00Z", 2026)).toBe(true);
  });

  it("considère non envoyé si le dernier envoi porte sur une année antérieure", () => {
    // Le récapitulatif 2025 envoyé en janvier 2026 ne vaut pas pour 2026.
    expect(recapitulatifDejaEnvoye("2026-01-05T09:00:00Z", 2026)).toBe(false);
  });

  it("considère non envoyé sans date, ou sur une date illisible", () => {
    expect(recapitulatifDejaEnvoye(null, 2026)).toBe(false);
    expect(recapitulatifDejaEnvoye("", 2026)).toBe(false);
    expect(recapitulatifDejaEnvoye("pas-une-date", 2026)).toBe(false);
  });
});

describe("INFORMATION_FISCALE", () => {
  it("cite l'URSSAF et l'administration fiscale, les deux destinataires", () => {
    expect(INFORMATION_FISCALE.texte).toMatch(/URSSAF/);
    expect(INFORMATION_FISCALE.texte).toMatch(/administration fiscale/);
  });

  it("dit qu'ALANE ne déclare pas à la place du prestataire", () => {
    expect(INFORMATION_FISCALE.texte).toMatch(/ne le faisant pas.*à votre place/s);
  });

  it("ne porte aucun montant chiffré — un seuil périmé est pire que pas de seuil", () => {
    expect(INFORMATION_FISCALE.texte).not.toMatch(/\d[\d\s]*€/);
  });
});
